# Sprint 1: Evidence and score

| | |
|---|---|
| **Dates** | Fri Nov 14 – Sat Nov 22, 2026 (9 days) |
| **Epic** | #10 |
| **Owner** | **Newton**: builds every story end to end |
| **Reviewer** | Ian: reviews every PR within a working day |
| **Load** | 44 pts |
| **Features** | F01 connector, F02 CSV + seeder, F03 score engine, F04 panel, F05 evidence drawer, F08 rules, F14 settings part one |

## Goal

Evidence is collected from every source, scored deterministically and shown in the issue panel.

**Done when:** on the dev site, *Settings → Data → Load demo data* runs, then opening `PAY-142` shows **score 89, suggested Highest (now Low), Silent fire**, with six tiles, three customers and an evidence drawer where **every number links to its source**.

## Starting point

- Workspace, CI, layer rules and the hello-world panel from Sprint 0.
- `src/core/result.ts` (`Result`, `ok`, `err`, `ErrorCode`) is the only core file.
- Spike adapters: `connector.ts`, `graph.ts`, `graph.queries.ts`, `jira.ts`, `storage.ts`, `llm.ts`. Extend these rather than starting over.
- `packages/contracts` has `IssueKey`, `ProjectKey` and the two property keys, but no schemas yet.
- Scoring rules are fully specified in [`../scoring.md`](../scoring.md); data shapes in [`../data-model.md`](../data-model.md); resolver contracts in [`../api-reference.md`](../api-reference.md) §1.
- Mock-ups: `design/project/Main.dc.html`, `PanelNarrow.dc.html`, `Settings.dc.html`, `Components.dc.html`.

## Stories at a glance

| # | Story | Pts | Prio | Depends on |
|---|---|---|---|---|
| 15 | Shared contracts + DTO types | 2 | P0 | — (merge first) |
| 11 | Score engine | 5 | P0 | 15 (types only) |
| 12 | Detection rules and confidence | 2 | P0 | 11 |
| 14 | CSV parsing and validation | 3 | P0 | — |
| 16 | Storage adapter: entity store, snapshots, KVS settings | 3 | P0 | 15 |
| 19 | Jira and JSM REST adapters | 3 | P0 | 15 |
| 17 | Connector adapter for customers and deals | 3 | P0 | 15 |
| 18 | Graph reader adapter for Q1–Q5 | 3 | P0 | Sprint 0 gate |
| 20 | Evidence collector and `getStakes` service | 5 | P0 | 11, 12, 16, 18, 19 |
| 21 | Demo seeder: load and remove Orbit Pay | 5 | P0 | 16, 17, 19 |
| 13 | Calibrate the demo score for the hero issues | 2 | P1 | 11, seed files from 21 |
| 22 | Issue panel | 5 | P0 | 15; real data from 20 |
| 23 | Settings page: Data and Scoring tabs | 3 | P0 | 14; resolvers from 17, 21 |

## Suggested order

This is the heaviest sprint (44 pts in 9 days), so work bottom-up: pure core first, because it needs no site and everything else depends on it. Then the adapters, then the service, then the UI. If the sprint slips, cut #13 (P1) first and carry #23's Scoring tab into Sprint 2.

| Day | Newton |
|---|---|
| Fri 14 | #15 contracts and DTO types. Finish the Sprint 0 site steps and the ADR-0001 gate |
| Sat 15 | #11 signals, normalisation, score, bands, with the full test matrix |
| Sun 16 | #12 detection and confidence. **Commit the demo seed files** (`scripts/demo-data/`, part of #21) |
| Mon 17 | #14 CSV. #16 storage. Build Session (live, Nov 17) |
| Tue 18 | #19 Jira/JSM REST adapter. #17 connector adapter |
| Wed 19 | #18 graph reader. #20 collector + `getStakes` + resolver |
| Thu 20 | #21 seeder. #13 calibration test against the seed files |
| Fri 21 | #22 panel, all states |
| Sat 22 | #23 settings Data and Scoring tabs. Rehearse the done-when demo; close the epic |

## Build order inside the sprint

1. **Types first (Fri 14).** `packages/contracts/src/dto.ts` exports `EvidenceItem`, `EvidenceType`, `EvidenceSource`, `SignalKey`, `Tier`, `Snapshot`, `PanelView`, `Settings`, `Weights`, `Bands`, exactly as written in `data-model.md` §3 and `api-reference.md` §1. Core code and the panel both import from here, because the frontend cannot import `src/`.
2. **Core functions.** `rawSignals`, `normalise`, `score`, `suggestPriority`, `detect`, `confidence`, all exported from `src/core/`. `getStakes` calls them in that order.
3. **Seed files early.** `apps/stakes/scripts/demo-data/{customers,deals,issues,requests,messages}.json` with the Orbit Pay dataset (see #21). `score.demo.test.ts` (#13) reads them.
4. **`parseCsv` before `importCsv`.** The `importCsv` service calls it before pushing through the connector.
5. **Panel last, against a fixture if needed.** If `getStakes` isn't on the site yet, render the panel from `test/fixtures/panel/pay-142.json`, a hand-written `PanelView` with the numbers from `scoring.md` §8.

## What Ian does during this sprint

Ian reviews every PR within a working day, completes the onboarding checklist in `WORKSPLIT.md`, and prepares Sprint 2. In practice that means scaffolding `static/backlog/` (Vite + React + Atlaskit) and building the table against a fixture `BacklogRow[]`. None of that depends on this sprint's code beyond the DTO types.

---

### #15 Shared contracts: issue-property zod schemas with round-trip tests (2 pts)

**Build**
- `packages/contracts/src/properties.ts`: `ShipNoticeProperty` and `BridgeCrmProperty` zod schemas exactly as in `data-model.md` §5, plus inferred types.
- A size guard for `stakesBridge.crm`: `fitBridgeCrm(value)` keeps the 50 largest deals by `amountUsd` and checks the serialised JSON is under 32 KB.
- `packages/contracts/src/dto.ts`: the shared types listed in hand-off 1. Types only, no logic.
- Re-export everything from `packages/contracts/src/index.ts`.

**Acceptance criteria**
- [ ] Both apps parse and serialise every shape in a round-trip test (`apps/stakes/test/contracts.test.ts` and `apps/stakes-bridge/test/contracts.test.ts`)
- [ ] Size guard keeps `stakesBridge.crm` under the property limit

**Tests:** valid and invalid examples for each schema, including probability out of range, a bad date and a negative amount. A 200-deal input comes out at 50 deals and under 32 KB.

---

### #16 Storage adapter: entity store, snapshots and KVS settings (3 pts)

**Build**
- Declare custom entities in `manifest.yml` under `app.storage.entities`: `customer`, `deal`, `deal_issue`, `snapshot`, `audit`, `ship_notice`, with the indexes in `data-model.md` §2.
- `src/adapters/storage.ts` grows narrow interfaces, one per need, so services take only what they use:
  - `MirrorStore`: `dealsForIssue(key)`, `customersByIds(ids)`, `upsertCustomers`, `upsertDeals` (also writes `deal_issue` rows), `deleteBySource('demo')`, `dealsVersion()`, `bumpDealsVersion()`
  - `SnapshotStore`: `latest(issueKey)`, `save(snapshot)`, `latestMany(keys)`
  - `SettingsStore`: `get()` (returns defaults when empty), `save(settings)`
  - `PercentileStore`: `get(projectKey)`, `save(projectKey, p95)`
- Default settings: weights from `scoring.md` §2, bands from §5, `weightsVersion: 1`, `llmEnabled: false`.

**Acceptance criteria**
- [ ] Indexed query for deals by issue works on the dev site
- [ ] Snapshot save and latest-by-issue read
- [ ] Entity-store item size limit checked against a full evidence list

**Tests:** contract tests with an in-memory fake of the Forge storage API. On the site, save a snapshot with about 40 evidence items. If it exceeds the item limit, split the evidence into a `snapshot_evidence` entity, as `data-model.md` §2 describes, and note the measured limit in that doc.

**Trap:** an entity-store index is on scalar fields only. That is why `deal_issue` exists: never try to index the `issueKeys[]` array.

---

### #17 Teamwork Graph connector adapter for customers and deals (3 pts)

**Build**
- Extend `src/adapters/connector.ts` (the spike already maps objects): `pushCustomers(customers)` and `pushDeals(deals)` in chunks of 100, each with `updateSequenceNumber = Date.now()`; `deleteBySource('demo')` using the ids recorded at seed time.
- Associations are set with the object (`associations.set` with `issueIdOrKeys`). `set` replaces the whole list, so a re-import always sends every issue key for the deal.
- `src/services/importCsv.ts`: `parseCsv` (#14) → resolve every issue key and owner email through the Jira adapter → abort with all rejections if anything fails → upsert the mirror → push through the connector → bump `mirror:dealsVersion`.
- Resolver `importCsv` (`confirmed: true`, admin only).

**Acceptance criteria**
- [ ] Re-import replaces objects with the full association list
- [ ] Every rejected object logged with id and reason, no values
- [ ] Remove demo data deletes everything it pushed

**Tests:** fake graph SDK. A 250-object push makes three calls. Rejected objects end up in the result and in the log line, with ids only.

---

### #18 Graph reader adapter for Q1–Q5 with degraded-read handling (3 pts)

**Build**
- `src/adapters/graph.ts`: implement `GraphReader` from `teamwork-graph.md` §3 over `graph.queries.ts`. Q1, Q3 and Q5 are persisted (`customQuery`), Q4 is curated (`jiraWorkItemGoals` + `atlassianGoalUpdates`), and Q2 has no graph query (escalations come from JSM in #19), so `escalationsForIssue` returns `ok: true, data: []`.
- Use `classifyGraphResponse` from the spike: HTTP 200 with `errors`, or an empty list where links are expected, is `degraded`.
- `makeAdapters({ as: 'app' })` returns a reader whose every method throws `Error('Teamwork Graph is user-only')`.
- Replace synthetic fixtures with recorded, scrubbed ones from the dev site.

**Acceptance criteria**
- [ ] Named operations `stakes_qN_*`
- [ ] Contract tests for happy, empty and error fixtures
- [ ] App-context factory returns a reader that throws

**Trap:** a missing scope returns partial or empty data, not an error. If Q4 comes back empty on an issue you know has a goal, check `read:graph:*` scopes before debugging code.

---

### #19 Jira and JSM REST adapters (3 pts)

**Build**
- `src/adapters/jira.ts` grows `JiraReader`:
  - `issue(key)`: summary, status and status category, priority, assignee, fix versions, components, story points, `updated`
  - `linkedRequests(key)`: linked `HELP` requests with priority, created date (for age), SLA time remaining, escalation flag (label `escalation` in the demo), assignee
  - `bridgeCrm(key)`: reads `stakesBridge.crm` and parses with the contracts schema; returns `null` if absent or invalid
  - `canView(key)`: true or false, used by every resolver before doing work
  - `accountIdForEmail(email)`, for CSV import
- Every path built with the `route` tag from `@forge/api`, and every user path called `asUser()`.

**Acceptance criteria**
- [ ] All calls `asUser` in user paths using the `route` tag
- [ ] 403 on a linked item is skipped and reported, not thrown
- [ ] Contract fixtures for each call

**Tests:** fixtures under `test/fixtures/jira/` for issue, links, request, SLA and property: happy, empty and 403.

---

### #20 Evidence collector and getStakes service with snapshot caching (5 pts)

**Build**
- `src/services/collect.ts`: build `EvidenceItem[]` from, in parallel:
  - deals and customers: graph Q1 → `stakesBridge.crm` → mirror, stopping at the first that answers (order per ADR-0001)
  - JSM requests and escalations (REST)
  - conversations (Q3, or mirror messages for the demo)
  - goals (Q4)
  - Each item has a stable `id` (`ev-<type>-<externalId>`), a `url` to its source and `source` set.
- `src/services/getStakes.ts`, shaped as in `architecture.md` §2:
  1. fresh-snapshot test: `computedAt` < 6 h, `issue.updated <= computedAt`, `dealsVersion` and `weightsVersion` unchanged → return the cache with **no graph call**
  2. otherwise collect → `rawSignals` → `normalise` (with percentiles or floors) → `score` → `suggestPriority` → `detect` → `confidence`
  3. `evidenceHash` = sha256 of evidence sorted by id, without `fetchedAt`
  4. summary: a template sentence from the top three contributions (the LLM arrives in Sprint 3)
  5. save the snapshot; record any failed sources in `degraded`
- `src/resolvers/`: `getStakes` (`{ issueKey, refresh? }` → `PanelView`). Validate the key, call `canView` (return `FORBIDDEN` if false), call the service, and map the snapshot to `PanelView` in a pure mapper.

**Acceptance criteria**
- [ ] Fresh snapshot (< 6h, issue/deals/weights unchanged) returned without any graph call
- [ ] Every evidence item carries its `source`
- [ ] Service tests with fake adapters: happy, degraded, empty

**Trap:** the 6-hour rule is not the only invalidation. Weight changes (#23) and re-imports (#17) bump versions that must also make the cache stale.

---

### #21 Demo seeder: load and remove the Orbit Pay dataset (5 pts)

**Build**
- `apps/stakes/scripts/demo-data/*.json`, all fictional names, matching `PROJECT.md` "Demo data and seed plan":
  - 25 `PAY` issues with story points and four deliberate priority mismatches
  - 15 `HELP` requests linked with "relates to", three marked as escalations
  - 8 customers and 12 deals (US$20K–220K, closing Nov 2026–Feb 2027)
  - fix version `2026.12` with `PAY-142` plus four others; two sprints (one active, one future)
  - 6 messages mentioning `PAY-142`; 30 days of history rows that give `PAY-118` one stakes jump
  - Hero issues: `PAY-142` (Low; Kilima US$220K 60%, Savanna US$160K 90%, Bluepeak US$100K 40%; 7 requests), `PAY-150` (Highest, no evidence), `PAY-118` (High; 1 deal, 4 requests, 2 escalated), `PAY-131` (Medium; 1 SMB customer)
- `src/services/seed.ts`, run as the admin through resolvers: create issues → requests → links → version → sprints → push customers and deals → write the mirror → write `percentiles:PAY` with the values in `scoring.md` §8 → backfill history → record every created id in `seed:status`.
- Owners map to the installing admin's account id. Everything gets the `stakes-demo` label or `source = demo`.
- Resolvers `seedDemo`, `getSeedStatus` (progress counts), `removeDemo` (`confirmed: true`).
- Work in steps the UI polls (`getSeedStatus`), so no single invocation hits the Forge time limit.

**Acceptance criteria**
- [ ] Owners mapped to the installing admin
- [ ] Everything tagged (`stakes-demo` label, `source = demo`) and removed by *Remove demo data*
- [ ] Completes in about a minute with progress shown

**Verify:** seed, remove, then seed again on the dev site. After the remove, `PAY` and `HELP` contain no demo issues and the mirror contains nothing from the demo.

---

### #11 Score engine: raw signals, normalisation, weights and bands (5 pts)

**Build:** pure functions in `apps/stakes/src/core/`, one file each, with signatures from `scoring.md` §1:

| File | Function | Key rules |
|---|---|---|
| `signals.ts` | `rawSignals(evidence, now)` | R = Σ open deals `amountUsd × probability` + Σ ARR of customers renewing ≤ 90 days. Closed-won and closed-lost deals are excluded. Customers are deduped by id. S = Σ (JSM priority weight 4/3/2/1 + 0.5 × ⌊age/14⌋), with escalations ×2. C = tier weights 3/2/1. H = message count in the last 30 days. G = 0, 1 or 1.5, taking the max across goals. U = days to the nearest close, renewal or SLA date, with past dates counting as 0 and no dates giving null |
| `normalise.ts` | `normalise(raw, p95, scoredCount)` | `min(1, ln(1+x)/ln(1+max(p95, floor)))`; floors R 100,000, S 5, C 3, H 5; floors when `scoredCount < 10`; G/1.5; U → `max(0, 1 − U/90)`, null → 0 |
| `score.ts` | `score(norm, weights)` | renormalise weights (reject all-zero); `round(100 × Σ wₖnₖ / Σ wₖ)`; contributions in unrounded points |
| `bands.ts` | `suggestPriority(score, bands)` | 75/55/35/15 boundaries; `null` if a band has no mapped priority |

**Acceptance criteria**
- [ ] Same input always gives the same score
- [ ] Every band boundary and p95/floor case tested
- [ ] > 90% line coverage of `src/core`

**Tests:** in `apps/stakes/test/core/`, cover the full matrix in `scoring.md` §9: each signal at 0, at the floor, at p95 and above p95; < 10 scored issues; weights not summing to 1; boundaries 14/15, 34/35, 54/55, 74/75; closed deals excluded; duplicate customers; past dates. Add a property test (random evidence, same output twice) with `fast-check` if you want it (add it as a dev dependency), or a seeded loop.

**Check yourself:** feed the `PAY-142` inputs from `scoring.md` §8 with p95s R 450,000, S 18, C 9, H 10. You must get **89**, with contributions 34.0 / 19.0 / 14.3 / 8.1 / 6.7 / 7.2.

---

### #12 Detection rules and confidence (2 pts)

**Build**
- `src/core/detect.ts`: `detect({ score, currentPriority, evidenceCount, score7DaysAgo, thresholds })` → badges. Silent fire: `score ≥ 55` and priority Low/Lowest. Phantom: priority High/Highest and `score < 15` and no evidence. Stakes jump: `score − score7DaysAgo ≥ 20`, with no badge when there is no history.
- `src/core/confidence.ts`: count distinct evidence types and the oldest `fetchedAt`. High = ≥ 3 types all ≤ 7 days old; Medium = 2 types, or ≥ 3 with something older; Low = 0 or 1 type.
- Thresholds come in as a parameter, read from `Settings` by the caller, never hard-coded inside the rule.

**Acceptance criteria**
- [ ] Boundary tests: 54/55, 14/15, +19/+20, 7-day-old evidence
- [ ] Thresholds read from settings

---

### #14 CSV parsing and validation (3 pts)

**Build:** `src/core/csv.ts`, pure, no library that does I/O.
- `parseCsv(text)`: RFC 4180 quoting (commas and newlines inside quotes), header row, trimmed cells.
- `validateCustomers(rows)` and `validateDeals(rows)`: required columns (`data-model.md` §7); amounts ≥ 0; probability 0–1, or 0–100 converted to 0–1; ISO dates; tier in Enterprise, Mid-market or SMB (case-insensitive); `blocked_by_issues` split on `;`, each key matching `ISSUE_KEY_PATTERN` from contracts.
- Safety: reject input over 1 MB or 5,000 rows, and reject text cells starting with `=`, `+`, `-` or `@` (formula injection).
- Return `{ ok: true, customers, deals }` or `{ ok: false, rejected: [{ file, row, reason }] }`. All-or-nothing: if any row fails, return every rejection.
- Also write the `previewCsv` resolver: parse and validate, then return the first 10 rows and the rejections.

**Acceptance criteria**
- [ ] Required columns, numeric amounts, probability, ISO dates, tiers, issue-key pattern validated
- [ ] Rejected rows listed with row number and reason; all-or-nothing
- [ ] Formula-injection cells and oversized input rejected

**Note:** whether issue keys exist, and which account an email belongs to, needs Jira. That check lives in the `importCsv` service (#17), not here.

---

### #13 Calibrate the demo score for the hero issues (2 pts)

**Build**
- `apps/stakes/test/core/score.demo.test.ts` loads the seed files from `scripts/demo-data/`, builds evidence for the four hero issues the way the collector would, and asserts: `PAY-142` 89 Highest + silent fire; `PAY-118` 72 High (and a stakes jump from the seeded history); `PAY-131` 25 Low; `PAY-150` 0 Lowest + phantom.
- Decide the open point in `scoring.md` §8: `updatePercentiles` would overwrite the seeded `percentiles:PAY`. Recommended answer: percentiles are recomputed only once a project has ≥ 10 scored issues **that are not demo data**, so demo projects keep their seeded values. Write the decision into `scoring.md` §8 and the hero table in `PROJECT.md`. Sprint 2 implements it when `updatePercentiles` lands.

**Acceptance criteria**
- [ ] Decision recorded in docs/scoring.md §8 and PROJECT.md
- [ ] `score.demo.test.ts` asserts all four hero issues from the real seed files

**If a hero misses its number,** tune the seed data (a deal stage, a request's age), not the formula, and note which file changed in the PR.

---

### #22 Issue panel: score header, six tiles, customers and evidence drawer (5 pts)

**Build:** replace the hello-world panel in `apps/stakes/src/frontend/panel.tsx` (UI Kit, `@forge/react`). Match `design/project/Main.dc.html` and `PanelNarrow.dc.html`. Top to bottom:
1. Header: score lozenge "89 / 100", confidence label, "Suggested: Highest (now Low)", badge lozenges with text (amber for Silent fire, grey for Phantom)
2. Summary text and "Summary from N evidence items" (template text for now)
3. Six tiles in a 2 × 3 grid: Revenue at risk, Customers, Support pressure, Conversation heat, Goal alignment, Urgency. Each shows its raw value with units ("US$480K · 3 deals") and "+N pts", and is clickable to filter the drawer to its `evidenceIds`
4. Up to five customers: name, tier, deal value, close or renewal date, owner
5. Evidence drawer, collapsible and grouped by type; every item is a link to `url`, with its `source` shown
6. Footer: "Updated 2 h ago · Refresh" (calls `getStakes` with `refresh: true`)

States: loading skeleton; no evidence ("No customers, deals or tickets are linked yet." plus an admin hint to load demo data); low confidence ("Based on limited evidence"); `degraded` contains `teamwork-graph` ("Teamwork Graph signals unavailable"); `FORBIDDEN` or partial access ("You don't have access to some linked items").

Leave space for the Apply button (Sprint 2), the sparkline (Sprint 2) and the Ship notice tab (Sprint 3), but don't build them.

**Acceptance criteria**
- [ ] Every number expands to linked sources
- [ ] Loading skeleton, no-evidence, low-confidence, graph-unavailable and no-permission states
- [ ] Cached load < 2 s; Refresh recomputes

**Tests:** a pure `formatTile(view, signal)` and similar helpers in `src/frontend/format.ts`, with unit tests (currency abbreviation, units, "+N pts" rounding). Before the `getStakes` resolver lands, render from `test/fixtures/panel/pay-142.json`.

**Verify:** on the dev site with demo data seeded, time a cached load from browser devtools.

---

### #23 Settings page: Data and Scoring tabs (3 pts)

**Build**
- Add a `jira:adminPage` module `stakes-settings` (UI Kit) → `src/frontend/settings.tsx`. Match `design/project/Settings.dc.html`.
- **Data tab:** connector status; two CSV inputs (paste or upload) → `previewCsv` → a 10-row preview table and a rejection list → *Import* (`importCsv`, `confirmed: true`); project pickers for the software and service projects → *Load demo data* (`seedDemo`) with a progress bar that polls `getSeedStatus`; *Remove demo data* (red, with a confirmation dialog) → `removeDemo`.
- **Scoring tab:** six weight sliders that renormalise live so they always sum to 1 (a pure helper with tests); band thresholds; band → priority mapping from the site's priority list (flag missing names); projects in scope.
- Resolvers: `getSettings`, `saveSettings` (admin check first, return `NOT_ADMIN` otherwise; bump `weightsVersion` when weights change).

**Acceptance criteria**
- [ ] Only Jira admins can save
- [ ] Changing weights bumps `weightsVersion` and invalidates snapshots in scope

**Trap:** the admin check must happen in the resolver, not only by hiding the Save button.

---

## Sprint review checklist (owner: Newton, with Ian watching the demo)

- [ ] `npm run test:coverage` ≥ 90% lines on `src/core`; CI green on `main`
- [ ] On the dev site: *Load demo data* completes in about a minute with progress shown
- [ ] `PAY-142` panel: 89, Highest (now Low), Silent fire, six tiles, three customers; every number opens its sources
- [ ] `PAY-150` shows the phantom badge; an issue with no evidence shows the empty state, not an error
- [ ] Changing a weight in Settings changes `PAY-142`'s score on the next load
- [ ] *Remove demo data* leaves nothing behind
- [ ] ADR-0001 accepted; `scoring.md` §8 decision written
- [ ] Unfinished stories moved to Sprint 2 with a note on the epic; epic #10 closed
