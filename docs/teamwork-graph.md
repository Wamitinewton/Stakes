# Teamwork Graph integration

Stakes uses the Teamwork Graph both ways: connectors **write** customers and deals in, and curated queries **read** relationships out. This file is the source of truth for both, and is updated with the final queries and explorer screenshots after the Phase 0 spike.

> **Unverified:** everything in this file until the Nov 13 gate. `graph:connector` is EAP and the Teamwork Graph API is Preview.

## 1. Write side: connectors

Both apps declare a `graph:connector` module (`stakes-crm` in `stakes`, a second one in `stakes-bridge`) pushing two object types.

### Customer organization

| Graph field | Source | Example |
|---|---|---|
| external id | `customer_id` | `CUST-007` |
| display name | `customer_name` | Kilima Freight |
| tier (attribute) | `tier` | Enterprise |
| ARR (attribute) | `arr_usd` | 420000 |
| renewal date (attribute) | `renewal_date` | 2027-03-31 |
| owner → Atlassian user | `owner_email` resolved to account id | — |

### Deal

| Graph field | Source | Example |
|---|---|---|
| external id | `deal_id` | `DEAL-031` |
| display name | `deal_name` | Kilima Freight — Enterprise expansion |
| amount, stage, probability, close date | CSV/CRM columns | 220000, Negotiation, 0.6, 2026-12-15 |
| owner → Atlassian user | `deal_owner_email` | — |
| association → Jira work items | `blocked_by_issues` | `PAY-142`, `PAY-118` |

Associations must be set **when the object is pushed**; the graph has no separate "link" call. Re-importing a deal re-pushes it with the full association list.

### Confirmed push shape (`@forge/teamwork-graph` 5.4)

- `graph.setObjects({ objects, connectionId })`, at most 100 objects per call; the response lists `accepted` and `rejected` (with per-object errors).
- `connectionId` comes from the `datasource.onConnectionChange` function, which fires `CREATED`, `UPDATED` or `DELETED` when an admin connects or disconnects the connector. Stakes keeps it in KVS (`connector:connectionId`). On `DELETED`, Atlassian removes the connection's objects itself.
- Required object fields: `schemaVersion` (`2.0`), `id`, `updateSequenceNumber`, `displayName`, `url`, `createdAt`, `lastUpdatedAt`, `permissions`. Stakes uses the push time in milliseconds as the sequence number, so a re-import always wins.
- Customer fields: `atlassian:customer-org.customerSegment` (tier) and `customerOrgLifeTimeValue { value, currencyCode }` (ARR). Deal fields: `atlassian:deal.stage`, `accountName`, `isClosed`, `opportunityAmount { value, currencyCode }`, `dealClosedAt`. There is no probability field, so probability stays in the mirror.
- Associations: `{ lastUpdatedAt, set: [{ associationType: 'issueIdOrKeys', values: ['PAY-142'] }] }`. `set` replaces the whole list.
- Scopes: `write:object:jira`, `read:object:jira`, `delete:object:jira`.

### Connector obligations

- Document data scope and permission handling in the README.
- Log every rejected object with id and reason (no values).
- Data stays until an admin disconnects the connector or runs *Remove demo data*.
- Bridge: deals removed in HubSpot are deleted from the graph on the next sync.

## 2. Read side: curated queries

All reads use `api.asUser().requestTeamworkGraph()` (backend) or `requestTeamworkGraph` from `@forge/bridge` (Custom UI). The API cannot be called as the app, and arbitrary Cypher is not accepted: each read is a **curated query** or a **persisted query** registered in advance.

| # | Operation name | Question | Relationship | Feeds |
|---|---|---|---|---|
| Q1 | `stakes_q1_deals` | Which deals and customers depend on this issue, and who owns them? | Deal → Jira work item; deal/customer → owner | R, C, U, recipients |
| Q2 | `stakes_q2_escalations` | Which support escalations are linked? | Jira work item ↔ support escalation | S |
| Q3 | `stakes_q3_conversations` | Who is talking about it? | Conversation/message mentions work item | H |
| Q4 | `stakes_q4_goals` | Which goal does it serve and is it at risk? | Work item contributes to goal; goal update | G |
| Q5 | `stakes_q5_team` | Which team owns it? | Team assigned work item | display, digest |

For each query, record here after the spike:

```md
### Q1 stakes_q1_deals
- Kind: curated | persisted
- Query text: <final GraphQL>
- Variables: { issueAri }
- Scopes: read:graph:<object>:<product>, ...
- Fixture files: test/fixtures/graph/q1.{happy,empty,error}.json
- Explorer screenshot: install-guide/q1.png
- Notes: <limits, pagination, gotchas>
```

## 3. Adapter contract

```ts
// adapters/graph.ts
export interface GraphReader {
  dealsForIssue(issueKey: IssueKey): Promise<GraphResult<DealWithCustomer[]>>;
  escalationsForIssue(issueKey: IssueKey): Promise<GraphResult<Escalation[]>>;
  conversationsForIssue(issueKey: IssueKey, sinceDays: number): Promise<GraphResult<Conversation[]>>;
  goalsForIssue(issueKey: IssueKey): Promise<GraphResult<Goal[]>>;
  teamForIssue(issueKey: IssueKey): Promise<GraphResult<Team | null>>;
}

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; degraded: true; reason: 'partial-errors' | 'unexpected-empty' | 'http-error' | 'timeout'; data?: T };
```

## 4. Rules for every graph call

1. **Name every operation** (`stakes_qN_*`) so failures are traceable in `forge logs`.
2. **Success means data and no errors.** HTTP 200 with an `errors` array, or an empty list where the issue is known to have links, is `degraded`, never "no evidence".
3. **Never from triggers, scheduled jobs or async consumers.** The app-context adapter factory returns a graph reader that throws.
4. **At most five queries per panel load**, run in parallel, results cached in the snapshot for six hours.
5. **Log ids and counts only**, never names or values.

## 5. Fallback (the Nov 13 gate)

The gate decides whether connector deals and customers can be read back through the API.

| Outcome | Deal and customer source | Graph still used for |
|---|---|---|
| Readable | Q1 (primary); mirror and bridge property as fallback | Q1–Q5 |
| Not readable | Mirror (CSV/demo) and `stakesBridge.crm` (live) | Q2–Q5; connector data still visible in Rovo Search |

Decision recorded in [ADR-0001](adr/0001-crm-read-path.md) and `CLAUDE.md`. Either way, each evidence item shows its `source`, so the claim "feeds and consumes the graph" stays honest.

## 6. Spike checklist (Phase 0)

- [ ] Developer account has `graph:connector` EAP access; connector write scope noted
- [ ] One customer and one deal pushed with an association to a `PAY` issue
- [ ] Read back through the API as a user: works / doesn't work
- [ ] Customer visible in Rovo Search
- [ ] Q2–Q5 written and run in the explorer
- [ ] Persisted query registration process documented (reports say browser session only)
- [ ] Fixtures recorded for happy, empty and error responses of every query
