# Sprint 4: Plan, Confluence and bridge

| | |
|---|---|
| **Dates** | Sun Dec 7 – Sat Dec 13, 2026 (7 days) |
| **Epic** | #44 |
| **Lead** | Ian |
| **Load** | Newton 11 pts · Ian 11 pts |
| **Features** | F18 weekly digest, F21 sprint planning assist, F22 live CRM sync, F23 Slack delivery, F24 Confluence macro |

## Goal

Sprint planning assist, the Confluence surfaces, and the optional bridge app with live CRM and Slack delivery.

**Done when:**
1. A deal edited in HubSpot (e.g. Kilima Freight's amount) changes `PAY-142`'s score after *Sync now* on the bridge settings page.
2. A ship notice sent from the panel appears in the Slack channel, and as a DM to the mapped owner, **within five minutes**.
3. The weekly digest page exists in Confluence under the configured parent page.
4. Journey A's second half: the Sprint plan tab proposes a scope for the future sprint within capacity, and Apply moves the issues after confirmation.

The two halves of this sprint barely touch each other: Newton works in `apps/stakes-bridge/`, Ian in `apps/stakes/`. That makes it the sprint with the least merge risk.

## Starting point

- `apps/stakes-bridge/` has a manifest, a hello settings page (`src/frontend/settings.tsx`), a resolver stub and a contracts round-trip test.
- `packages/contracts` has `BridgeCrmProperty` (with the 50-deal size guard) and `ShipNoticeProperty`, from Sprint 1.
- `stakes` already reads `stakesBridge.crm` second in its source chain (#20), and writes `stakes.shipNotice` on Send (#34).
- Confluence was added as an optional product in Sprint 0.
- Accounts needed: a HubSpot developer account with a private app token, and a Slack workspace with a bot. Newton holds these. Tokens **never** go in the repo.

## Stories at a glance

| # | Story | Owner | Pts | Prio | Depends on |
|---|---|---|---|---|---|
| 45 | Sprint scope knapsack | Ian | 3 | P1 | — |
| 46 | Sprint plan tab with confirmed apply | Ian | 3 | P1 | 45 |
| 47 | Weekly Confluence digest | Ian | 3 | P1 | S1 snapshots |
| 48 | Confluence Stakes macro | Ian | 2 | P2 | S2 services |
| 49 | Bridge settings page with secret storage | Newton | 2 | P1 | — |
| 50 | Bridge: hourly HubSpot sync through its connector | Newton | 5 | P1 | 49, 52 |
| 51 | Bridge: Slack delivery of sent ship notices | Newton | 3 | P1 | 49, S3 #34 |
| 52 | HubSpot demo-data loader script | Newton | 1 | P2 | — |

## Suggested order

| Day | Newton | Ian |
|---|---|---|
| Sun 7 | #52 loader script; load HubSpot | #45 knapsack + brute-force tests |
| Mon 8 | #49 bridge settings + secret storage | #45 capacity default. #46 `planSprint` service |
| Tue 9 | #50 HubSpot client + fixtures | #46 Sprint plan tab + `applySprintPlan` |
| Wed 10 | #50 connector push + `stakesBridge.crm` write + deletions | #47 digest service + page builder |
| Thu 11 | #51 delivery job | #47 scheduled trigger, settings Confluence tab |
| Fri 12 | #51 idempotency, DMs. Bridge install on the dev site | #48 macro |
| Sat 13 | Review | **Lead:** rehearse all four done-when checks; close the epic |

## Hand-offs in this sprint

1. **`planSprint` for the Rovo action (Ian → Newton).** When #46's service lands, `suggest-sprint-scope` (Sprint 3 stub) calls it. Ian makes that one-line change in `src/actions/` and Newton reviews.
2. **Ship notice property (contract, both).** The bridge reads `stakes.shipNotice` with `status = sent AND deliveredAt IS EMPTY`, and writes `deliveredAt` back. If either side needs a new field, change `packages/contracts` first, in its own PR.

---

## Ian's stories

### #45 Sprint scope knapsack (3 pts)

**Build:** `src/core/knapsack.ts`, pure.
- `planScope({ candidates: [{ issueKey, points, score }], pinned: IssueKey[], capacity })` returns `{ chosen, pointsUsed, scoreCovered }`.
- Pinned issues (already in the sprint) are always kept and use up capacity first.
- 0/1 knapsack by dynamic programming over integer points (round fractional points up). Issues with no points are skipped, and listed in the result as "needs an estimate".
- Tie-break deterministically (higher score, then lower key) so the output is stable.
- `defaultCapacity(lastSprints)` = the average completed points of the last three closed sprints (fewer if fewer exist; `null` if none).

**Acceptance criteria**
- [ ] Optimal on small inputs (tested against brute force)
- [ ] Default capacity: average completed points of the last three sprints

**Tests:** random inputs of ≤ 12 items compared against brute force, 200 runs.

---

### #46 Sprint plan tab with confirmed apply (3 pts)

**Build**
- `src/services/planSprint.ts`: load the board's future sprints, issues already in the chosen sprint (pinned), open unassigned-to-sprint issues with snapshots, and the last three sprints' completed points → `planScope`. Returns `SprintPlan` (proposed issues with score, revenue, points, plus totals).
- Resolvers `planSprint({ boardId, sprintId, capacity? })` and `applySprintPlan({ sprintId, issueKeys, confirmed: true })`. The latter moves issues via the Agile REST API as the user and writes one `audit` row per move.
- Backlog page *Sprint plan* tab: sprint picker, capacity input (prefilled with the default), proposed scope table, totals (score covered, revenue covered, points used / capacity), *Apply* → confirmation listing the issues → result.
- Manifest scopes: `read:sprint:jira-software`, `write:sprint:jira-software`, `read:board-scope:jira-software`.

**Acceptance criteria**
- [ ] Nothing moves without confirmation; audit row written

---

### #47 Weekly Confluence digest (3 pts)

**Build**
- Scheduled trigger `weekly-digest`. If Forge can't pin the day and hour, run daily and exit unless it's Monday after 06:00 UTC. Runs `asApp`, **from stored snapshots only** (no graph).
- `src/services/digest.ts`: for each project in scope, build the page with the top five silent fires, fixes shipped in the last seven days (from ship notices), revenue unblocked, and phantom priorities still open. Intro text via `TextWriter` (`digest`), falling back to a template.
- Create the page under the configured parent page, or update it if `digest:last:<projectKey>` has this week's `pageId`.
- If Confluence isn't in the installation, record `skipped: confluence-not-connected` and return.
- Settings *Confluence* tab: digest on/off, parent page picker, connected status with instructions for adding Confluence.
- Add a manual "Run digest now" button for the demo and for testing.

**Acceptance criteria**
- [ ] Updates the week's page instead of duplicating
- [ ] Skips and records why when Confluence isn't connected

---

### #48 Confluence Stakes macro (2 pts, P2)

**Build**
- Manifest `macro` key `stakes-macro` (UI Kit) → `src/frontend/macro.tsx`, with a config panel offering three modes: project (key), fix version (project + version), customer (search).
- Resolver `macroTable({ mode, key })`, as the viewing user, reusing `rankBacklog`, `releaseStakes` or `customerExposure` → top ten rows (score, priority, badge, revenue at risk) and the backlog page URL.

**Acceptance criteria**
- [ ] Links to the Jira backlog page

---

## Newton's stories

### #52 HubSpot demo-data loader script (1 pt, P2)

**Build:** `apps/stakes-bridge/scripts/load-hubspot.ts`. It reads the same eight customers and twelve deals from `apps/stakes/scripts/demo-data/` and creates HubSpot companies and deals, with a custom deal property `jira_issue_keys` (e.g. `PAY-142;PAY-118`). The token is read from the `HUBSPOT_TOKEN` environment variable, never from a file in the repo. Re-running it updates records instead of duplicating them (match on a custom external id property).

**Acceptance criteria**
- [ ] Each deal carries `jira_issue_keys`; no credentials in the repo

---

### #49 Bridge settings page with secret storage (2 pts)

**Build**
- `apps/stakes-bridge/src/frontend/settings.tsx` (UI Kit admin page): HubSpot private-app token field; Slack bot token and default channel; a "Sync now" button; status (last sync, counts, last error code).
- Resolvers `saveHubspotToken`, `saveSlackConfig` (each tested once on save: HubSpot account-info call, Slack `auth.test`), `syncNow`, `getStatus`.
- Tokens stored with Forge secret storage (`@forge/kvs` secret API). The UI only ever gets "configured · ••••1a2b".
- A clear statement on the page: "This optional app sends data to HubSpot and Slack, so it is not Runs on Atlassian eligible. The core Stakes app is."
- Manifest: `permissions.external.fetch.backend` with `api.hubapi.com` and `slack.com`.

**Acceptance criteria**
- [ ] Tokens never returned to the UI or logged
- [ ] Page states the bridge is not Runs on Atlassian eligible

---

### #50 Bridge: hourly HubSpot sync through its connector (5 pts)

**Build**
- Bridge adapters: `hubspot.ts` (companies and deals with `jira_issue_keys`, paginated), `connector.ts` (its own `graph:connector` module `bridge-crm`, same object mapping as `stakes`), `jira.ts` (issue property writes as the app).
- `src/services/sync.ts`: pull → map to customers and deals → push through the connector with associations → group deals by issue key → write `stakesBridge.crm` on each linked issue (parsed by the contracts schema, trimmed by `fitBridgeCrm`) → delete graph objects, and clear properties, for deals that disappeared since the last sync (keep the previous id set in KVS).
- Scheduled trigger `crm-sync` (hour) and the `syncNow` resolver call the same service.
- Contract fixtures for HubSpot responses: happy, empty, 401, rate-limited.

**Acceptance criteria**
- [ ] Sync now button
- [ ] Deals removed in HubSpot are deleted from the graph on the next sync

**Verify:** change Kilima Freight's deal amount in HubSpot → *Sync now* → refresh the `PAY-142` panel. R changes and the evidence item shows `source: bridge`.

---

### #51 Bridge: Slack delivery of sent ship notices (3 pts)

**Build**
- Scheduled trigger `deliver` (fiveMinute). JQL: `issue.property[stakes.shipNotice].status = sent AND issue.property[stakes.shipNotice].deliveredAt IS EMPTY`.
- For each issue: post the internal note to the default channel; look up each owner's Atlassian email → Slack `users.lookupByEmail` → DM. Write `deliveredAt` **after** a successful post. Use the issue key + `sentAt` as an idempotency key in KVS, so a re-run never double-posts even if the property write failed.
- Send only the internal note and owner emails to Slack, nothing else.
- Fixtures for Slack responses: ok, `users_not_found`, `channel_not_found`, rate-limited.

**Acceptance criteria**
- [ ] Delivered once even if the job runs twice
- [ ] Delivery within five minutes of Send

---

## Sprint review checklist (lead: Ian)

- [ ] Sprint plan tab proposes a scope within capacity for the future demo sprint; Apply moves the issues after confirmation; audit rows exist
- [ ] Rovo `suggest-sprint-scope` now returns a real plan
- [ ] Digest page created under the parent page; running it again updates the same page
- [ ] Removing Confluence from a test installation makes the digest record `skipped: confluence-not-connected`
- [ ] Macro renders in all three modes and links to the backlog page
- [ ] HubSpot edit → *Sync now* → `PAY-142` score changes
- [ ] Deleting a deal in HubSpot removes it from the graph on the next sync
- [ ] Ship notice Send → Slack channel post and owner DM in under five minutes; running the job twice posts once
- [ ] `forge eligibility` still clean for `stakes`; no tokens anywhere in the repo (`git grep` for the token prefixes)
- [ ] Epic #44 closed; unfinished stories moved with a note
