# Architecture

## 1. System context

Stakes runs entirely on Atlassian Forge. There is no server we host, no database we operate, and the core app makes no outbound network calls.

```mermaid
flowchart LR
    U[Jira / Confluence user] --> STAKES
    RU[Rovo chat user] --> STAKES
    EXT[External AI client<br/>Claude · Cursor · Copilot] -->|MCP| STAKES
    subgraph Forge["Atlassian Forge"]
        STAKES[stakes<br/>core app, no egress]
        BRIDGE[stakes-bridge<br/>optional, has egress]
    end
    STAKES <--> TWG[(Teamwork Graph)]
    STAKES <--> JIRA[(Jira + JSM)]
    STAKES <--> CONF[(Confluence)]
    BRIDGE --> TWG
    BRIDGE <-->|issue entity properties| JIRA
    BRIDGE -->|HTTPS| HUB[HubSpot]
    BRIDGE -->|HTTPS| SLACK[Slack]
```

## 2. Layers inside `stakes`

Strict one-way dependencies, enforced by `eslint-plugin-boundaries`:

```mermaid
flowchart TB
    subgraph Entry["Entry points (thin)"]
        RES[resolvers/]
        ACT[actions/]
        TRG[triggers/]
    end
    SVC[services/<br/>orchestration]
    CORE[core/<br/>pure TypeScript, no I/O]
    ADP[adapters/<br/>only place that imports @forge/*]
    FE[frontend/ + static/backlog/] -->|invoke via @forge/bridge| RES
    RES --> SVC
    ACT --> SVC
    TRG --> SVC
    SVC --> CORE
    SVC --> ADP
```

| Layer | May import | Must not import | Responsibility |
|---|---|---|---|
| `core/` | other `core/` files, `packages/contracts` | `@forge/*`, `adapters/`, `services/` | Score, normalisation, bands, detection, confidence, sprint knapsack, CSV parsing, numeric guard |
| `adapters/` | `@forge/*`, `core/` types | `services/`, entry points | One narrow interface per external system: `graph`, `jira`, `jsm`, `confluence`, `storage`, `llm`, `connector`, `field` |
| `services/` | `core/`, adapter **interfaces** | concrete adapters directly | Use cases: `getStakes`, `rankBacklog`, `releaseStakes`, `customerExposure`, `planSprint`, `shipNotice`, `weeklyDigest` |
| `resolvers/`, `actions/`, `triggers/` | `services/`, adapter factories | `core/` logic (call a service instead) | Validate input, build adapters for the right auth context, call one service, shape the response |
| `frontend/`, `static/backlog/` | `@forge/bridge`, `@forge/react`, `packages/contracts` types | anything in `src/` | Render; call resolvers only |

Services receive adapters as parameters (constructor or function argument), so tests pass fakes and never need a site.

```ts
// services/getStakes.ts (shape, not final code)
export interface GetStakesDeps {
  graph: GraphReader;
  jira: JiraReader;
  storage: SnapshotStore;
  llm: SummaryWriter;
  clock: () => Date;
}

export async function getStakes(deps: GetStakesDeps, issueKey: IssueKey, opts: { refresh: boolean }): Promise<Snapshot>;
```

### Auth context

Forge offers two identities: `asUser()` (the viewing user) and `asApp()` (the app). The entry point decides which one the adapters use.

| Path | Identity | Teamwork Graph allowed? |
|---|---|---|
| Resolvers (panel, backlog, settings, macro) | `asUser()` | Yes |
| Rovo actions, MCP tools | `asUser()` (the caller) | Yes |
| Product event triggers | `asApp()` | **No.** No user means no graph reads |
| Scheduled triggers (digest, nightly) | `asApp()` | **No** |

Adapter factories make this explicit: `makeAdapters({ as: 'user' })` and `makeAdapters({ as: 'app' })`. The app-context factory returns a graph adapter that throws, so a mistake fails loudly in tests.

## 3. Request flows

### 3.1 Issue panel load (`getStakes`)

```mermaid
sequenceDiagram
    participant P as Issue panel (UI Kit)
    participant R as resolver getStakes
    participant S as services/getStakes
    participant ST as storage
    participant G as graph (asUser)
    participant J as jira/jsm REST (asUser)
    participant C as core
    participant L as llm
    P->>R: invoke('getStakes', {issueKey, refresh})
    R->>R: validate key, check user can view issue
    R->>S: getStakes(deps, key)
    S->>ST: latest snapshot
    alt fresh (< 6h, issue + deals + weights unchanged)
        ST-->>S: snapshot
    else stale or refresh
        par up to 5 named queries
            S->>G: Q1..Q5
        and
            S->>J: linked JSM requests + SLAs, issue fields
        and
            S->>ST: mirror deals / stakesBridge.crm fallback
        end
        S->>C: buildEvidence → score → detect → confidence
        S->>L: summary(evidenceHash) (cached, budget-checked, guarded)
        S->>ST: save snapshot + history row
        S->>J: set Stakes Score custom field
    end
    S-->>R: Snapshot
    R-->>P: PanelView DTO
```

Fresh-snapshot test, in order: `computedAt` within six hours, `issue.updated <= computedAt`, mirror `dealsVersion` unchanged, `settings.weightsVersion` unchanged.

### 3.2 Backlog ranking

The backlog page lists open issues through a resolver, reads cached snapshots in one call, then recomputes stale ones **from the browser** in batches of 20 (`recomputeBatch`). This keeps every graph read `asUser` and each invocation inside the Forge time limit. Sorting, filtering and the "cut" toggle on the Releases tab are pure client-side computations over the returned DTOs.

```mermaid
sequenceDiagram
    participant B as Backlog (Custom UI)
    participant R as resolvers
    B->>R: listBacklog(projectKey)
    R-->>B: issues + cached snapshots + staleKeys[]
    loop while staleKeys not empty
        B->>R: recomputeBatch(next 20 keys)
        R-->>B: snapshots
        B->>B: update table, progress "Scoring 37 of 60"
    end
    B->>R: updatePercentiles(projectKey)
```

### 3.3 Ship notice

```mermaid
sequenceDiagram
    participant T as trigger (asApp)
    participant ST as storage
    participant P as Issue panel (asUser)
    participant J as Jira/JSM
    participant BR as stakes-bridge (5-min schedule)
    participant SL as Slack
    T->>ST: on Done / version released: read last snapshot recipients
    T->>J: read current JSM links (REST)
    T->>ST: save ship_notice {status: pending}
    P->>ST: next viewer sees banner + drafts
    P->>J: Send: comment @owners, JSM replies (as user)
    P->>J: set property stakes.shipNotice {status: sent}
    BR->>J: JQL status = sent AND deliveredAt IS EMPTY
    BR->>SL: channel post + owner DMs
    BR->>J: set deliveredAt
```

Triggers never post comments: anything visible to people happens as the human who clicked Send.

### 3.4 CRM ingestion

| Source | Path | Lands in |
|---|---|---|
| CSV upload | settings page → `importCsv` resolver → `core/csv` validate → connector adapter | Teamwork Graph + entity-store mirror |
| Demo seeder | settings page → `seedDemo` → Jira REST (issues, requests, links, version, sprints) + connector | Same + Jira projects |
| Live HubSpot | `stakes-bridge` hourly trigger → bridge connector | Teamwork Graph + `stakesBridge.crm` issue property |

The evidence collector reads deals in this order, stopping at the first source that answers:

1. Teamwork Graph Q1 (if the Nov 13 gate confirms connector deals are queryable).
2. `stakesBridge.crm` issue property (live data, if the bridge is installed).
3. Entity-store mirror (CSV and demo data).

Every evidence item records which `source` it came from, and the panel shows it.

## 4. The two-app split

`stakes` must stay eligible for **Runs on Atlassian**, which allows no external domains other than analytics. Live CRM sync and Slack delivery need egress, so they live in `stakes-bridge`. See [ADR-0002](adr/0002-two-app-split.md).

The apps never share storage. Their only contract is:

| Channel | Direction | Shape defined in |
|---|---|---|
| Teamwork Graph connector objects | bridge → graph → stakes | [teamwork-graph.md](teamwork-graph.md) |
| `stakesBridge.crm` issue property | bridge → stakes | `packages/contracts` |
| `stakes.shipNotice` issue property (JQL-indexed) | stakes → bridge (and `deliveredAt` back) | `packages/contracts` |

Both apps import the same `packages/contracts` types and zod schemas, and a round-trip test in each app guards the contract.

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Graph returns HTTP 200 with `errors` or an unexpectedly empty list | Logged as `degraded`, evidence item list marked partial; panel shows "Teamwork Graph signals unavailable"; score still computed from other sources |
| Graph call throws or times out | Same as above |
| Jira REST 403 on a linked item | Item skipped; panel shows "You don't have access to some linked items" |
| LLM off, over budget, error, or guard rejects output | Template summary; no error shown |
| Confluence not in the installation | Digest records `skipped: confluence-not-connected`; macro and settings explain how to add it |
| Snapshot write fails | Panel still renders the computed result; next load recomputes |

Rule: a degraded data source lowers **confidence**, it never shows an error page.

## 6. Performance budget

| Operation | Budget | How |
|---|---|---|
| Panel, cached | < 2 s | One storage read, no graph or LLM call |
| Panel, cold | < 8 s | Graph queries in parallel, LLM summary cached by evidence hash |
| Backlog batch | 20 issues per invocation | Client-driven loop |
| Graph queries per panel load | ≤ 5 | Q1–Q5 only |
