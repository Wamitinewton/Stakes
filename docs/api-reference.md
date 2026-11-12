# API reference

Every entry point validates its input with a zod schema, checks the caller's access, calls **one** service, and returns a typed DTO. Errors are returned as values, not thrown to the UI.

```ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export type ErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_ADMIN'
  | 'CONFIRMATION_REQUIRED' | 'STALE_PREVIEW' | 'UPSTREAM_DEGRADED' | 'INTERNAL';
```

## 1. Resolvers (UI → backend)

Called from the UI with `invoke('<name>', payload)` from `@forge/bridge`. All run `asUser`.

### Issue panel

| Resolver | Input | Output | Notes |
|---|---|---|---|
| `getStakes` | `{ issueKey, refresh?: boolean }` | `PanelView` | Cached unless `refresh` |
| `getHistory` | `{ issueKey, days?: 30 }` | `{ points: {date, score}[], jump: boolean }` | |
| `applyPriority` | `{ changes: {issueKey, from, to}[], confirmed: true }` | `{ applied: IssueKey[], failed: {issueKey, code}[] }` | Rejects if `from` no longer matches current priority (`STALE_PREVIEW`). Posts audit comment as user |
| `getShipNotice` | `{ issueKey }` | `ShipNoticeView \| null` | |
| `draftCustomerUpdate` | `{ issueKey, customerId?, tone: 'brief' \| 'detailed' }` | `{ text, citedIds, generated }` | Sonnet |
| `sendShipNotice` | `{ issueKey, internalNote, customerReplies: {requestKey, text, visibility: 'public-draft' \| 'internal'}[], confirmed: true }` | `{ commentId, replies: {requestKey, ok}[] }` | Writes `stakes.shipNotice` |
| `dismissShipNotice` | `{ issueKey }` | `{ ok }` | |

### Backlog page

| Resolver | Input | Output |
|---|---|---|
| `listBacklog` | `{ projectKey }` | `{ rows: BacklogRow[], staleKeys: IssueKey[], summary }` |
| `recomputeBatch` | `{ issueKeys: IssueKey[] }` (max 20) | `{ rows: BacklogRow[] }` |
| `updatePercentiles` | `{ projectKey }` | `{ p95 }` |
| `getReleaseStakes` | `{ projectKey, versionId }` | `ReleaseView` |
| `searchCustomers` | `{ query }` | `{ customers: {id, name, tier}[] }` |
| `getCustomerExposure` | `{ customerId }` | `CustomerView` |
| `planSprint` | `{ boardId, sprintId, capacity?: number }` | `SprintPlan` |
| `applySprintPlan` | `{ sprintId, issueKeys, confirmed: true }` | `{ moved, failed }` |

### Settings (Jira admins only; every write checks admin)

| Resolver | Input | Output |
|---|---|---|
| `getSettings` | — | `Settings` |
| `saveSettings` | `Partial<Settings>` | `Settings` (weights renormalised, `weightsVersion` bumped if changed) |
| `previewCsv` | `{ customersCsv?, dealsCsv? }` | `{ preview: rows[10], rejected: {row, reason}[] }` |
| `importCsv` | same + `confirmed: true` | `{ customers, deals, rejected: [] }` or `INVALID_INPUT` with every rejection |
| `seedDemo` | `{ softwareProjectKey, serviceProjectKey }` | `{ status }` (progress via `getSeedStatus`) |
| `getSeedStatus` | — | `SeedStatus` |
| `removeDemo` | `{ confirmed: true }` | `{ deleted: counts }` |
| `getLlmUsage` | — | `{ today, budget, rejections }` |

### Confluence macro

| Resolver | Input | Output |
|---|---|---|
| `macroTable` | `{ mode: 'project' \| 'version' \| 'customer', key }` | `{ rows: MacroRow[10], backlogUrl }` |

### Key DTOs

```ts
interface PanelView {
  issueKey: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  currentPriority: string;
  suggestedPriority: string | null;
  badges: string[];
  summary: { text: string; generated: boolean; sourceCount: number };
  tiles: Array<{ signal: SignalKey; label: string; rawDisplay: string; points: number; evidenceIds: string[] }>;
  customers: Array<{ id: string; name: string; tier: Tier; dealValueUsd: number; date: string | null; ownerAccountId: string | null }>;
  evidence: EvidenceItem[];
  degraded: string[];
  computedAt: string;
  hasPendingShipNotice: boolean;
}

interface BacklogRow {
  issueKey: string; summary: string; status: string; assignee: string | null;
  score: number | null; currentPriority: string; suggestedPriority: string | null;
  revenueUsd: number; customers: number; tickets: number; badges: string[];
  trend: 'up' | 'down' | 'flat'; storyPoints: number | null; fixVersions: string[]; components: string[];
}
```

## 2. Rovo actions

All read-only (`actionVerb: GET`), so Rovo shows no confirmation dialog. Each returns JSON with `sources: {title, url}[]`.

| Action key | Inputs | Returns |
|---|---|---|
| `get-issue-stakes` | `issueKey` (req) | score, confidence, signals, suggested priority, top 10 evidence |
| `rank-backlog` | `projectKey` (req), `limit` (10), `filter` (`all` \| `silent-fires` \| `phantoms`) | ranked issues with score, priority, badge |
| `find-customer-exposure` | `customer` (name or id, req) | open issues, deal value, renewal date, owners |
| `get-release-stakes` | `projectKey`, `version` (req) | revenue unblocked, customers served, issues by score |
| `draft-customer-update` | `issueKey` (req), `customer`, `tone` (`brief` \| `detailed`) | draft text, evidence ids used |
| `get-score-trend` | `issueKey` or `projectKey` | 30-day history, stakes jumps |
| `suggest-sprint-scope` | `projectKey`, `sprint` (req), `capacity` | proposed issues, points, score and revenue covered |

Action handlers read only from snapshots and fresh `getStakes` calls; they never write priorities or sprints.

## 3. MCP tools

The `rovo:mcp` module exposes the same seven handlers:

| Tool | Handler |
|---|---|
| `stakes_get_issue_stakes` | `get-issue-stakes` |
| `stakes_rank_backlog` | `rank-backlog` |
| `stakes_find_customer_exposure` | `find-customer-exposure` |
| `stakes_get_release_stakes` | `get-release-stakes` |
| `stakes_draft_customer_update` | `draft-customer-update` |
| `stakes_get_score_trend` | `get-score-trend` |
| `stakes_suggest_sprint_scope` | `suggest-sprint-scope` |

External access is off by default; a site admin enables it per installation. Clients connect at `https://mcp.atlassian.com/forge/<appId>` and run with the calling user's permissions. `skill.md` at the repo root tells agents when to use the tools.

## 4. Triggers and scheduled jobs (run `asApp`)

| Key | Event | Handler | Does |
|---|---|---|---|
| `on-issue-updated` | `avi:jira:updated:issue` | `onIssueUpdated` | Invalidate snapshot; if moved into Done category and has stakes → create pending ship notice |
| `on-version-released` | `avi:jira:released:version` | `onVersionReleased` | Pending ship notice for each issue in the version with stakes |
| `nightly-maintenance` | daily | `nightly` | Compact history to one row/day, purge > 30 days, audit > 180 days, old LLM cache and usage keys |
| `weekly-digest` | weekly (Mon ~06:00 UTC) | `weeklyDigest` | One Confluence page per project from stored snapshots only |

Triggers must be idempotent: a ship notice is keyed by `issueKey + trigger + versionId`, so a duplicate event updates instead of duplicating.

> **Unverified:** whether Forge `scheduledTrigger` with `interval: week` lets us pick the day and hour. If not, run daily and exit unless it is Monday.

## 5. `stakes-bridge` entry points

| Key | Kind | Does |
|---|---|---|
| `bridge-settings` | `jira:adminPage` resolvers: `saveHubspotToken`, `saveSlackConfig`, `syncNow`, `getStatus` | Tokens tested once on save, stored in secret storage |
| `crm-sync` | `scheduledTrigger` hour | Pull HubSpot companies and deals with `jira_issue_keys`, push to bridge connector, write `stakesBridge.crm` |
| `deliver` | `scheduledTrigger` fiveMinute | JQL for sent, undelivered notices → Slack channel + DMs → write `deliveredAt` |
