# Data model

All `stakes` data lives in Forge storage (custom entity store and KVS) and in Jira issue entity properties. Nothing is stored outside Atlassian.

## 1. Where each kind of data lives

| Data | Store | Why there |
|---|---|---|
| Customers, deals, deal↔issue links (mirror) | Entity store | Indexed queries ("deals for PAY-142", "customers by owner") |
| Snapshots and 30-day history | Entity store | Indexed by project+score and issue+time |
| Audit records | Entity store | Queried by issue and time |
| Ship notices | Entity store | Queried by status and issue |
| Settings, counters, caches | KVS | Small key-value blobs |
| Cross-app handoff | Jira issue entity properties | The only storage both apps can see |
| Score for JQL | `jira:customField` value | Native Jira sort/filter |
| Bridge tokens | Forge secret storage (bridge only) | Never in KVS or manifest |

## 2. Entity store

Declared in `apps/stakes/manifest.yml` under `app.storage.entities`. The storage tests run against an in-memory fake that reads those declarations, so writing an undeclared attribute or querying an undeclared index fails in CI.

| Entity | Key | Fields | Indexes | Writers |
|---|---|---|---|---|
| `customer` | customer id | `id`, `name`, `tier`, `arrUsd`, `renewalDate`, `ownerAccountId`, `source` | `by-owner`, `by-renewal`, `by-name`, `by-source` | CSV import, seeder |
| `deal` | deal id | `id`, `customerId`, `name`, `amountUsd`, `stage`, `probability`, `closeDate`, `closed`, `ownerAccountId`, `issueKeys[]`, `source` | `by-customer`, `by-owner`, `by-close-date`, `by-source` | CSV import, seeder |
| `deal_issue` | `dealId:issueKey` | `issueKey`, `refId` (deal id), `source` | `by-issue`, `by-ref`, `by-source` | CSV import, seeder |
| `customer_issue` | `customerId:issueKey` | `issueKey`, `refId` (customer id), `source` | `by-issue`, `by-ref`, `by-source` | Seeder (direct customer links) |
| `message` | message id | `id`, `issueKey`, `channel`, `author`, `text`, `at`, `url`, `source` | `by-issue`, `by-source` | Seeder (demo conversations) |
| `snapshot` | issue key | see `Snapshot` below | `by-project-score` | Score engine |
| `history` | `issueKey:day` | `issueKey`, `projectKey`, `day`, `score`, `badges`, `source` (`computed` or `demo`) | `by-issue-day`, `by-project-day`, `by-day`, `by-source` | Score engine, seeder |
| `audit` | id | `id`, `issueKey`, `kind`, `from`, `to`, `score`, `topEvidence[]`, `actorAccountId`, `at` | `by-issue`, `by-at` | Apply actions |
| `llm_cache` | evidence hash + purpose (+ customer, tone) | `text`, `citedIds[]`, `createdAt`, `usedAt` | `by-used` | `TextWriter`; nightly purge of rows unused for 30 days |
| `ship_notice` | `issueKey:trigger:versionId` | `id`, `issueKey`, `trigger`, `versionId`, `versionName`, `recipients[]`, `jsmRequests[]`, `customers[]`, `internalDraft`, `internalGenerated`, `citedIds[]`, `status` (`pending`, `sent`, `dismissed`), `createdAt`, `updatedAt`, `sentBy`, `sentAt`, `dismissedBy` | `by-status`, `by-issue` | Triggers, Send, Dismiss |

`deal_issue` and `customer_issue` exist because entity-store indexes are on scalar fields; one row per link turns "deals blocked by PAY-142" into a single indexed query. A re-import replaces a deal's link rows, the same way the connector replaces its associations.

`snapshot` holds only the latest result per issue, so the cached panel load is one key lookup. History lives in its own entity with one row per issue per day: a recompute later the same day overwrites that day's row, so history needs no compaction, only the 30-day purge.

The entity store drops `null` on typed attributes, so the adapter leaves nulls out on write and restores them on read.

> **Item size:** a snapshot with 40 long evidence items serialises to about 25 KB, well under the 240 KiB value limit, so evidence stays inside the snapshot. Confirm on the dev site with a real `PAY-142` snapshot; if it ever approaches the limit, move evidence to a `snapshot_evidence` entity keyed by issue.

## 3. Core types (`packages/contracts/src/dto.ts`)

The frontend cannot import `src/`, so every type a resolver returns lives in `packages/contracts`. Abridged:

```ts
export type IssueKey = string;          // validated: /^[A-Z][A-Z0-9_]+-\d+$/
export type Tier = 'enterprise' | 'mid-market' | 'smb';
export type SignalKey = 'R' | 'S' | 'C' | 'H' | 'G' | 'U';

export type EvidenceType = 'deal' | 'customer' | 'jsm_request' | 'escalation' | 'conversation' | 'goal';
export type EvidenceSource = 'teamwork-graph' | 'jira-rest' | 'mirror' | 'bridge';

// What the score reads. Display fields are for people; facts are for arithmetic.
export type EvidenceFacts =
  | { kind: 'deal'; dealId; customerId; amountUsd; probability; stage; closeDate; closed; ownerAccountId }
  | { kind: 'customer'; customerId; name; tier; arrUsd; renewalDate; ownerAccountId }
  | { kind: 'request'; requestKey; priority; createdAt; slaBreachAt; escalated; assigneeAccountId }
  | { kind: 'conversation'; at; channel }
  | { kind: 'goal'; status: 'on-track' | 'at-risk' | 'off-track' | 'unknown' };

export interface EvidenceItem {
  id: string;               // stable: `ev-${type}-${externalId}`
  type: EvidenceType;       // an escalated request has type 'escalation'
  title: string;
  value: number | null;
  unit: 'USD' | 'count' | 'days' | null;
  detail: string;
  url: string;
  signal: SignalKey;        // the tile it is grouped under in the drawer
  source: EvidenceSource;
  fetchedAt: string;        // ISO 8601
  facts: EvidenceFacts;
}

export interface Snapshot {
  issueKey: IssueKey;
  projectKey: string;
  score: number;                              // 0..100 integer
  confidence: 'high' | 'medium' | 'low';
  raw: Record<SignalKey, number | null>;
  normalised: Record<SignalKey, number>;
  contributions: Record<SignalKey, number>;   // points, unrounded
  evidence: EvidenceItem[];
  currentPriority: string;
  suggestedPriority: string | null;
  badges: Array<'silent-fire' | 'phantom' | 'stakes-jump'>;
  weightsUsed: Record<SignalKey, number>;
  weightsVersion: number;
  dealsVersion: number;                       // mirror:dealsVersion at compute time
  evidenceHash: string;                       // sha256 of canonical evidence JSON
  summary: { text: string; generated: boolean; citedIds: string[] };
  degraded: EvidenceSource[];                 // sources that failed this run with no fallback
  hiddenItems: number;                        // linked items the viewer can't see
  computedAt: string;
}

export interface Settings {
  weights: Record<SignalKey, number>;         // renormalised to sum to 1
  weightsVersion: number;
  bands: {
    thresholds: { highest: 75; high: 55; medium: 35; low: 15 };
    priorities: Record<'highest' | 'high' | 'medium' | 'low' | 'lowest', string | null>;
  };
  jumpThreshold: number;                      // 20
  projectsInScope: string[];
  llmEnabled: boolean;
  dailyLlmBudgetCredits: number;
  digestParentPageId: string | null;
}
```

`evidenceHash` is computed over evidence sorted by `id`, with `fetchedAt` **excluded**, so refetching unchanged data doesn't invalidate the LLM cache.

## 4. KVS keys

| Key | Value | Notes |
|---|---|---|
| `settings:global` | `Settings` (weights, `weightsVersion`, bands, band→priority map, projects in scope, `llmEnabled`, `dailyLlmBudgetCredits`, digest parent page) | Admin page only |
| `llm:usage:<YYYY-MM-DD>` | `{ credits, calls, inputTokens, outputTokens }` (credits estimated from tokens) | Checked before each call; nightly job deletes days older than 30 |
| `llm:rejections:<YYYY-MM-DD>` | number of guard rejections | Shown on the AI tab; deleted with the usage key |
| `seed:status` | `SeedStatus` (`state`, step, progress, counts, project keys, story-key map) | Polled by the settings page |
| `seed:record` | Every id the seeder created (issues, requests, version, sprints, connector objects) | Removal deletes exactly these |
| `percentiles:<projectKey>` | `{ R, S, C, H, scoredCount, at, seeded }` | Recomputed after backlog refresh; seeded values are kept until the project has 10 non-demo scored issues |
| `digest:last:<projectKey>` | `{ pageId, weekStart }` | Update instead of duplicating |
| `mirror:dealsVersion` | number | Bumped on every import; part of the snapshot freshness check |

## 5. Issue entity properties (cross-app contract)

Defined once in `packages/contracts` as zod schemas; both apps parse with them.

```ts
export const ShipNoticeProperty = z.object({
  status: z.enum(['sent']),
  internalNote: z.string().max(2000),
  ownerAccountIds: z.array(z.string()),
  sentAt: z.string().datetime(),
  deliveredAt: z.string().datetime().optional(),
});
// property key: stakes.shipNotice; indexed by jira:entityProperty, JQL aliases
// stakesShipNoticeStatus and stakesShipNoticeDeliveredAt

export const BridgeCrmProperty = z.object({
  deals: z.array(z.object({
    id: z.string(),
    name: z.string(),
    amountUsd: z.number().nonnegative(),
    stage: z.string(),
    probability: z.number().min(0).max(1),
    closeDate: z.string().date().nullable(),
    ownerAccountId: z.string().nullable(),
    customer: z.object({ id: z.string(), name: z.string(), tier: z.enum(['enterprise', 'mid-market', 'smb']) }),
  })),
  syncedAt: z.string().datetime(),
});
// property key: stakesBridge.crm
```

Issue properties are limited in size (32 KB per property). The bridge keeps only the fields above and truncates to the 50 largest deals per issue.

### Demo request dates (`stakes.demo`)

Jira stamps `created` itself, so seeded `HELP` requests carry the demo story's dates in an app-owned issue property: `{ createdAt, slaBreachAt: null }`. The Jira reader prefers it over `created` and skips the live SLA for those requests, so a demo ticket "open 15 days" stays 15 days on the seed day whatever the service project's SLA settings are.

## 6. Lifecycle and retention

| Data | Created | Invalidated / deleted |
|---|---|---|
| Snapshot | Every recompute | Stale after 6 h, or earlier on issue update, re-import, weight change. Nightly job keeps one row per issue per day for 30 days |
| Audit | Every applied change | Deleted after 180 days |
| Ship notice | Trigger | `dismissed` or `sent`; deleted after 90 days |
| Mirror | Import/seed | Replaced on re-import of the same ids; *Remove demo data* deletes `source = demo` |
| LLM cache (`llm_cache` entity, so the nightly job can query by last use) | First generation | Unused for 30 days → deleted nightly |

## 7. CSV format

Two files (or two pasted blocks): customers and deals.

```csv
customer_id,customer_name,tier,arr_usd,renewal_date,owner_email
CUST-007,Kilima Freight,Enterprise,420000,2027-03-31,owner@example.com
```

```csv
deal_id,deal_name,customer_id,amount_usd,stage,probability,close_date,deal_owner_email,blocked_by_issues
DEAL-031,Kilima Freight — Enterprise expansion,CUST-007,220000,Negotiation,0.6,2026-12-15,owner@example.com,PAY-142;PAY-118
```

Validation (in `core/csv.ts`, pure): required columns present; numeric amounts ≥ 0; probability in 0–1 (or 0–100, converted); ISO dates; tier in the allowed set; every issue key matches the pattern. The resolver then checks that every issue key exists and resolves emails to account ids, discarding the emails. Import is all-or-nothing: any rejected row aborts the commit and lists every rejection with row number and reason.
