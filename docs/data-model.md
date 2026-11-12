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

| Entity | Fields | Indexes | Writers |
|---|---|---|---|
| `customer` | `id`, `name`, `tier`, `arrUsd`, `renewalDate`, `ownerAccountId`, `source` | `by-owner`, `by-renewal`, `by-name` | CSV import, seeder |
| `deal` | `id`, `customerId`, `name`, `amountUsd`, `stage`, `probability`, `closeDate`, `ownerAccountId`, `issueKeys[]`, `source` | `by-customer`, `by-owner`, `by-close-date` | CSV import, seeder |
| `deal_issue` | `dealId`, `issueKey` | `by-issue` | CSV import, seeder |
| `snapshot` | see `Snapshot` type below | `by-project-score`, `by-issue-computed-at` | Score engine |
| `audit` | `id`, `issueKey`, `kind`, `from`, `to`, `score`, `topEvidence[]`, `actorAccountId`, `at` | `by-issue`, `by-at` | Apply actions |
| `ship_notice` | `issueKey`, `trigger`, `recipients[]`, `jsmRequests[]`, `internalDraft`, `customerDraft`, `status`, `createdAt`, `sentBy` | `by-status`, `by-issue` | Triggers, Send |

`deal_issue` exists because entity-store indexes are on scalar fields; one row per link turns "deals blocked by PAY-142" into a single indexed query.

> **Unverified:** entity-store index and field-size limits. Snapshots carry an evidence array; if a snapshot exceeds the item size limit, store evidence in a separate `snapshot_evidence` entity keyed by snapshot id.

## 3. Core types (`packages/contracts` and `src/core/types.ts`)

```ts
export type IssueKey = string;          // validated: /^[A-Z][A-Z0-9_]+-\d+$/
export type AccountId = string;
export type Tier = 'enterprise' | 'mid-market' | 'smb';
export type SignalKey = 'R' | 'S' | 'C' | 'H' | 'G' | 'U';

export type EvidenceType = 'deal' | 'customer' | 'jsm_request' | 'escalation' | 'conversation' | 'goal';
export type EvidenceSource = 'teamwork-graph' | 'jira-rest' | 'mirror' | 'bridge';

export interface EvidenceItem {
  id: string;               // stable: `ev-${type}-${externalId}`
  type: EvidenceType;
  title: string;
  value: number | null;
  unit: 'USD' | 'count' | 'days' | null;
  detail: string;
  url: string;
  signal: SignalKey;
  source: EvidenceSource;
  fetchedAt: string;        // ISO 8601
}

export interface Snapshot {
  issueKey: IssueKey;
  projectKey: string;
  score: number;                              // 0..100 integer
  confidence: 'high' | 'medium' | 'low';
  raw: Record<SignalKey, number | null>;
  normalised: Record<SignalKey, number>;
  contributions: Record<SignalKey, number>;   // points
  evidence: EvidenceItem[];
  suggestedPriority: string | null;
  badges: Array<'silent-fire' | 'phantom' | 'stakes-jump'>;
  weightsUsed: Record<SignalKey, number>;
  weightsVersion: number;
  evidenceHash: string;                       // sha256 of canonical evidence JSON
  summary: { text: string; generated: boolean; citedIds: string[] };
  degraded: EvidenceSource[];                 // sources that failed this run
  computedAt: string;
}
```

`evidenceHash` is computed over evidence sorted by `id`, with `fetchedAt` **excluded**, so refetching unchanged data doesn't invalidate the LLM cache.

## 4. KVS keys

| Key | Value | Notes |
|---|---|---|
| `settings:global` | `Settings` (weights, `weightsVersion`, bands, band→priority map, projects in scope, `llmEnabled`, `dailyLlmBudgetCredits`, digest parent page) | Admin page only |
| `llm:usage:<YYYY-MM-DD>` | credits used | Checked before each call; nightly job deletes old days |
| `llm:cache:<key>` | `{ text, citedIds, createdAt }` | Keyed by evidence hash + purpose |
| `seed:status` | `{ state: 'not-loaded' \| 'loading' \| 'loaded', counts, createdIds }` | Drives the seeder button and removal |
| `percentiles:<projectKey>` | `{ R, S, C, H, scoredCount, at }` | Recomputed after backlog refresh |
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
// property key: stakes.shipNotice  (JQL alias via jira:entityProperty: stakesShipNotice)

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

## 6. Lifecycle and retention

| Data | Created | Invalidated / deleted |
|---|---|---|
| Snapshot | Every recompute | Stale after 6 h, or earlier on issue update, re-import, weight change. Nightly job keeps one row per issue per day for 30 days |
| Audit | Every applied change | Deleted after 180 days |
| Ship notice | Trigger | `dismissed` or `sent`; deleted after 90 days |
| Mirror | Import/seed | Replaced on re-import of the same ids; *Remove demo data* deletes `source = demo` |
| LLM cache | First generation | Unused for 30 days → deleted nightly |

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
