# Sprint 2: Decide

| | |
|---|---|
| **Dates** | Sun Nov 23 – Sat Nov 29, 2026 (7 days) |
| **Epic** | #24 |
| **Lead** | Ian |
| **Load** | Newton 9 pts (+ Sprint 1 spill-over) · Ian 13 pts |
| **Features** | F07 backlog page, F08 badges, F09 apply priority, F15 releases, F16 custom field, F17 customers, F19 history, F20 context badge |

## Goal

The backlog is ranked by evidence, and a human can apply suggested priorities with an audit trail.

**Done when:**
1. **Journey A runs end to end on the dev site.** Open *PAY → Stakes*, see `PAY-142` near the top with a Silent fire badge and `PAY-150` with Phantom priority. Select both, then *Apply suggested priorities*. The confirmation lists both changes; confirm. `PAY-142` becomes Highest and `PAY-150` becomes Lowest, and each gets an audit comment naming the approving user.
2. In Jira issue search, `"Stakes Score[Number]" >= 55 ORDER BY "Stakes Score[Number]" DESC` returns `PAY-142`.

(The sprint-plan half of Journey A arrives in Sprint 4.)

## Starting point

- Sprint 1 delivered: `getStakes` service and resolver, snapshots in the entity store, the panel, settings Data and Scoring tabs, the seeder, and pure scoring in `src/core/`.
- `static/backlog/` does not exist yet. ADR-0003 chose React + Vite + Atlaskit for this page.
- Mock-ups: `design/project/Backlog.dc.html`, `Release.dc.html`, `Customer.dc.html`.

## Stories at a glance

| # | Story | Owner | Pts | Prio | Depends on |
|---|---|---|---|---|---|
| 25 | Backlog page scaffold with progressive scoring | Ian | 5 | P0 | `getStakes` (S1) |
| 26 | Backlog ranking table, filters, search and badges | Ian | 3 | P0 | 25 |
| 27 | Apply suggested priority with confirmation and audit comment | Newton | 3 | P0 | S1 panel |
| 28 | Stakes Score custom field searchable in JQL | Newton | 2 | P1 | `getStakes` (S1) |
| 30 | Score history, nightly compaction and sparkline | Newton | 3 | P1 | S1 snapshots |
| 31 | Releases tab with revenue unblocked and cut toggle | Ian | 3 | P1 | 25 |
| 32 | Customers tab with exposure view | Ian | 2 | P1 | 25 |
| 29 | Issue context badge | Newton | 1 | P2 | S1 snapshots |

## Suggested order

| Day | Newton | Ian |
|---|---|---|
| Sun 23 | Finish any Sprint 1 spill-over. `rankBacklog` + `updatePercentiles` services (for #25) | #25 Vite + Atlaskit scaffold, manifest module, `listBacklog` resolver |
| Mon 24 | #27 `applyPriority` resolver + audit comment | #25 `recomputeBatch` loop and progress bar |
| Tue 25 | #27 panel Apply button. #28 custom field | #26 table, summary strip, badges |
| Wed 26 | #30 history service, `getHistory`, nightly job | #26 filters, search, row drawer, bulk bar (uses `applyPriority`) |
| Thu 27 | #30 sparkline + jump badge in the panel | #31 Releases tab |
| Fri 28 | #29 context badge. Integration fixes | #32 Customers tab |
| Sat 29 | Review | **Lead:** rehearse Journey A and the JQL query; close the epic |

## Hand-offs in this sprint

1. **Backlog services (Newton, Sun 23).** `src/services/rankBacklog.ts`: `listBacklog(projectKey)` returns open issues with their cached snapshots and `staleKeys`; `recomputeBatch(keys)` runs `getStakes` on up to 20 keys; `updatePercentiles(projectKey)` recomputes p95s with the demo rule decided in #13. Ian writes the resolvers and the UI on top.
2. **`applyPriority` (Newton, Mon 24).** Input `{ changes: [{ issueKey, from, to }], confirmed: true }`, output `{ applied, failed }`. Ian's bulk action bar calls it, and Newton wires the panel's single-issue button.
3. **Release and customer services (Newton, by Wed 26).** `releaseStakes(projectKey, versionId)` and `customerExposure(customerId)`, plus `searchCustomers(query)`, as pure aggregations over snapshots and the mirror. They are small: if Newton is behind, Ian writes them in `src/services/` and Newton reviews.

---

## Ian's stories

### #25 Backlog page scaffold with progressive scoring (5 pts)

**Build**
- `apps/stakes/static/backlog/`: Vite + React 18 + TypeScript + Atlaskit (`@atlaskit/tokens`, `@atlaskit/dynamic-table`, `@atlaskit/lozenge`, `@atlaskit/button`, `@atlaskit/tabs`, `@atlaskit/progress-bar`). Add it as a workspace so CI type-checks and lints it. It may import only `@forge/bridge` and `@stakes/contracts`.
- Manifest: `jira:projectPage` key `stakes-backlog`, resource `static/backlog/dist`, title "Stakes". Make `npm run build` produce `dist/` before `forge deploy`.
- Four tabs: Backlog, Releases, Customers, Sprint plan (the last is a placeholder until Sprint 4).
- Resolvers: `listBacklog`, `recomputeBatch` (reject > 20 keys with `INVALID_INPUT`), `updatePercentiles`.
- Client loop from `architecture.md` §3.2: list → while `staleKeys` remain, send the next 20 → merge rows → progress "Scoring 37 of 60" → `updatePercentiles` at the end.
- Theme with design tokens only (`token('color.text')`, etc.) so light and dark both work. Call `view.theme.enable()` from `@forge/bridge`.

**Acceptance criteria**
- [ ] Progress bar "Scoring N of M issues"
- [ ] No resolver call exceeds the Forge time limit on a 60-issue project
- [ ] Light and dark themes via design tokens

**Verify:** seed, then create 35 extra throwaway issues so the project has 60. Clear snapshots, load the page, and watch `forge logs` for invocation times.

---

### #26 Backlog ranking table, filters, search and badges (3 pts)

**Build** (match `Backlog.dc.html`)
- Summary strip: issues scored, silent fires, phantoms, total revenue at risk.
- Filter bar: search (key or summary), version, component, assignee, customer, "Silent fires only", "Phantoms only". Filtering and sorting are pure client-side functions in `static/backlog/src/lib/filter.ts`, with tests.
- Ranked table: checkbox, rank, key + summary (links to the issue), score bar **with the number as text**, current → suggested priority, revenue, customers, tickets, badge lozenge with text, trend arrow.
- Row drawer: the same content as the issue panel (tiles, customers, evidence) for that row, from `getStakes`.
- Bulk action bar when rows are selected: *Apply suggested priorities* → a confirmation modal listing every `KEY: from → to` → `applyPriority` → toast with applied and failed counts → refresh those rows.

**Acceptance criteria**
- [ ] Filters: version, component, assignee, customer, silent fires only, phantoms only
- [ ] Badges carry text, not only colour

**Accessibility:** every control reachable by keyboard; the modal traps focus; the score bar has an `aria-label`.

---

### #31 Releases tab with revenue unblocked and cut toggle (3 pts)

**Build** (match `Release.dc.html`)
- Version picker (unreleased versions of the project) → `getReleaseStakes` → revenue unblocked (sum of distinct deals across the version's issues; a deal blocked by several issues counts once), distinct customers served, and issues ranked by score.
- Each issue row has a "cut" toggle. Toggling recomputes the totals **in the browser** with a pure function, and lists which customers would lose their fix: customers whose every blocking issue in this version has been cut.

**Acceptance criteria**
- [ ] Shows which customers would lose their fix when an issue is cut

**Tests:** the pure `applyCuts(release, cutKeys)` function, including the case where a deal is blocked by two issues and only one is cut, so its customer does not lose the fix.

---

### #32 Customers tab with exposure view (2 pts)

**Build** (match `Customer.dc.html`)
- Search box → `searchCustomers({ query })` (name prefix or exact id, from the mirror).
- Selecting a customer → `getCustomerExposure` → tier, renewal date, owner, total deal value at risk, and every open issue they wait on (key, summary, status, fix version, score).

**Acceptance criteria**
- [ ] Search by name or id

**Verify:** "Kilima" finds Kilima Freight, which waits on `PAY-142` and `PAY-118`.

---

## Newton's stories

### #27 Apply suggested priority with confirmation and audit comment (3 pts)

**Build**
- Resolver `applyPriority`, as the user. Require `confirmed: true` (`CONFIRMATION_REQUIRED` otherwise). For each change: `canView`, then read the current priority. If it differs from `from`, add the change to `failed` with `STALE_PREVIEW`. Otherwise set the priority via REST and post the audit comment.
- Audit comment (always a template, never an LLM): old → new priority, score, top three evidence items with links, "Approved by @user via Stakes".
- Write an `audit` entity row `{ issueKey, kind: 'priority', from, to, score, topEvidence, actorAccountId, at }`.
- Panel: an *Apply* button beside "Suggested: X (now Y)", opening a confirmation dialog. Hide it when `suggestedPriority` is null.

**Acceptance criteria**
- [ ] Confirmation lists every change; nothing changes without it
- [ ] Stale preview rejected if priority changed since it was shown
- [ ] Audit comment with old/new priority, score, top three evidence items and approving user

**Tests:** service tests with a fake Jira: happy, stale, 403 and a mixed batch.

---

### #28 Stakes Score custom field searchable in JQL (2 pts)

**Build**
- Manifest: `jira:customField` key `stakes-score-field`, type `number`, read-only, name "Stakes Score".
- `src/adapters/field.ts`: set the value through the app field-value API (`PUT /rest/api/3/app/field/{fieldIdOrKey}/value`) as the app. This is the one non-user write allowed, because it's app data.
- Call it from `getStakes` whenever a snapshot is saved, and from the seeder.

**Acceptance criteria**
- [ ] `"Stakes Score[Number]" >= 55 ORDER BY "Stakes Score[Number]" DESC` works

**Trap:** the field must be added to the project's screens to show on the issue, but JQL works without that. Check the JQL alias Jira actually generates and put it in the README.

---

### #30 Score history, nightly compaction and sparkline (3 pts)

**Build**
- Every snapshot save also stores a history row (or reuse snapshot rows by `by-issue-computed-at`).
- `getHistory({ issueKey, days: 30 })` returns one point per day (the last of that day) and `jump: boolean`.
- `detect` already takes `score7DaysAgo`; `getStakes` now supplies it from history.
- Scheduled trigger `nightly-maintenance` (daily, `asApp`, **no graph calls**): keep one row per issue per day for 30 days, delete older rows, delete audit rows older than 180 days.
- Panel: a 30-day sparkline under the customers block (a small inline SVG if UI Kit has no chart component that fits), and the Stakes jump badge.
- The seeder's backfilled history gives `PAY-118` a jump on day one.

**Acceptance criteria**
- [ ] Nightly job compacts and purges history and old audit rows
- [ ] Seeded history shows one stakes jump on day one

---

### #29 Issue context badge (1 pt, P2)

**Build**
- Manifest: `jira:issueContext` key `stakes-issue-context` → `src/frontend/badge.tsx`.
- Resolver `getBadge(issueKey)` reads the latest snapshot **only**: no graph or LLM call, and no recompute when it's stale. Render "89 · Silent fire", or "89" with no badge, or "Not scored yet".

**Acceptance criteria**
- [ ] No graph or LLM call on render

---

## Sprint review checklist (lead: Ian)

- [ ] Backlog page loads and scores 60 issues with a progress bar and no time-outs in `forge logs`
- [ ] Journey A done on the dev site: both suggestions applied after one confirmation, with audit comments on both issues
- [ ] Changing `PAY-142`'s priority in another tab, then applying from the stale page, gives "priority changed since you looked"
- [ ] JQL query returns `PAY-142`
- [ ] `PAY-118` shows a sparkline and a Stakes jump badge
- [ ] Releases: cutting `PAY-142` from `2026.12` shows Kilima Freight, Savanna Health and Bluepeak Retail losing their fix (unless another issue in the release covers them)
- [ ] Customers: Kilima Freight shows its open issues and exposure
- [ ] Light and dark theme both readable
- [ ] Epic #24 closed; unfinished stories moved with a note
