# Work split: Newton and Ian

Stakes is built by two people from **14 November to 22 December 2026**. This page says who owns what and why, and how the two of us work together without getting in each other's way. The detailed, story-by-story guide for each sprint is in [`sprints/`](sprints/README.md).

| Person | GitHub | Lane |
|---|---|---|
| **Newton** | `Wamitinewton` | Data and platform: Teamwork Graph, Jira/JSM REST, storage, services, triggers, AI plumbing, Rovo/MCP, `stakes-bridge`, security, deploys |
| **Ian** | `Dancan254` | Product surfaces and pure logic: score engine, detection, CSV, guard, knapsack, issue panel, settings, backlog page and tabs, Confluence, install and fresh-eyes testing |

## 1. How the split was chosen

1. **Lanes over turns.** Each person owns whole layers, so we rarely edit the same files in the same week. Newton mostly writes `src/adapters/`, `src/services/`, `src/triggers/`, `src/actions/` and `apps/stakes-bridge/`. Ian mostly writes `src/core/`, `src/frontend/`, `static/backlog/` and the resolvers behind those screens.
2. **Site-bound work stays with whoever holds the access.** The Teamwork Graph connector is EAP, persisted queries are registered from a browser session on the dev site, and the Sprint 0 site steps are half done. Newton already holds all of that, so graph, connector and bridge work stays with Newton.
3. **Pure work is the fastest way in.** `src/core/` needs no Forge site: just Vitest and the rules in [`scoring.md`](scoring.md). Ian starts there in Sprint 1 (score engine, detection, CSV), so Ian is productive on day one while their site access is still being set up.
4. **Every story has one owner.** The owner builds it end to end: core, service, resolver, UI and tests. The other person reviews the PR and answers questions about their interfaces. Nobody "helps finish" someone else's story without moving the card to their own name first.
5. **The reviewer is never the author.** Ian writes the prompts and the numeric guard, so Newton runs the AI quality review. Newton builds the apps, so Ian runs the integration checklist and the fresh-install test.

## 2. Sprint leads

Each sprint has a lead who runs the board, chases blockers, makes sure the "done when" demo is rehearsed on the dev site before review, and writes the sprint review notes on the epic. Leading a sprint does not mean doing more of its stories.

| Sprint | Dates | Epic | Lead | Guide |
|---|---|---|---|---|
| 0 Foundation and spikes | Nov 10–13 | #1 | Newton | [sprint-0-foundation.md](sprints/sprint-0-foundation.md) |
| 1 Evidence and score | Nov 14–22 | #10 | Newton | [sprint-1-evidence-and-score.md](sprints/sprint-1-evidence-and-score.md) |
| 2 Decide | Nov 23–29 | #24 | Ian | [sprint-2-decide.md](sprints/sprint-2-decide.md) |
| 3 Loop and AI | Nov 30–Dec 6 | #33 | Newton | [sprint-3-loop-and-ai.md](sprints/sprint-3-loop-and-ai.md) |
| 4 Plan, Confluence and bridge | Dec 7–13 | #44 | Ian | [sprint-4-plan-confluence-bridge.md](sprints/sprint-4-plan-confluence-bridge.md) |
| 5 Harden, install and record | Dec 14–19 | #53 | Ian | [sprint-5-harden-install-record.md](sprints/sprint-5-harden-install-record.md) |
| 6 Submit and buffer | Dec 20–22 | #63 | Newton | [sprint-6-submit.md](sprints/sprint-6-submit.md) |

## 3. Who owns what, sprint by sprint

Points are the board's `Estimate` field (roughly ideal days).

### Sprint 1: Evidence and score

| # | Story | Owner | Pts |
|---|---|---|---|
| 15 | Shared contracts: issue-property zod schemas with round-trip tests (plus the shared DTO types, first PR of the sprint) | Newton | 2 |
| 16 | Storage adapter: entity store, snapshots and KVS settings | Newton | 3 |
| 17 | Teamwork Graph connector adapter for customers and deals | Newton | 3 |
| 18 | Graph reader adapter for Q1–Q5 with degraded-read handling | Newton | 3 |
| 19 | Jira and JSM REST adapters | Newton | 3 |
| 20 | Evidence collector and `getStakes` service with snapshot caching | Newton | 5 |
| 21 | Demo seeder: load and remove the Orbit Pay dataset | Newton | 5 |
| 11 | Score engine: raw signals, normalisation, weights and bands | Ian | 5 |
| 12 | Detection rules and confidence | Ian | 2 |
| 13 | Calibrate the demo score for the hero issues | Ian | 2 |
| 14 | CSV parsing and validation | Ian | 3 |
| 22 | Issue panel: score header, six tiles, customers and evidence drawer | Ian | 5 |
| 23 | Settings page: Data and Scoring tabs | Ian | 3 |
| | **Newton 24 · Ian 20** | | |

### Sprint 2: Decide

| # | Story | Owner | Pts |
|---|---|---|---|
| 27 | Apply suggested priority with confirmation and audit comment | Newton | 3 |
| 28 | Stakes Score custom field searchable in JQL | Newton | 2 |
| 29 | Issue context badge | Newton | 1 |
| 30 | Score history, nightly compaction and sparkline | Newton | 3 |
| 25 | Backlog page scaffold with progressive scoring | Ian | 5 |
| 26 | Backlog ranking table, filters, search and badges | Ian | 3 |
| 31 | Releases tab with revenue unblocked and cut toggle | Ian | 3 |
| 32 | Customers tab with exposure view | Ian | 2 |
| | **Newton 9 (plus Sprint 1 spill-over buffer) · Ian 13** | | |

### Sprint 3: Loop and AI

| # | Story | Owner | Pts |
|---|---|---|---|
| 34 | Ship notice triggers on Done and version release | Newton | 3 |
| 36 | LLM adapter with budget, cache and model config | Newton | 3 |
| 40 | Seven read-only Rovo actions | Newton | 5 |
| 42 | MCP tools and `skill.md` | Newton | 2 |
| 43 | AI quality review: 20 sampled outputs | Newton | 1 |
| 35 | Ship notice tab: review drafts, Send and Dismiss | Ian | 3 |
| 37 | Numeric guard for AI output | Ian | 3 |
| 38 | Prompts: why-it-matters summary, ship note and customer update | Ian | 3 |
| 39 | Settings: AI tab | Ian | 1 |
| 41 | Stakes Analyst Rovo agent | Ian | 2 |
| | **Newton 14 · Ian 12** | | |

### Sprint 4: Plan, Confluence and bridge

| # | Story | Owner | Pts |
|---|---|---|---|
| 49 | Bridge settings page with secret storage | Newton | 2 |
| 50 | Bridge: hourly HubSpot sync through its connector | Newton | 5 |
| 51 | Bridge: Slack delivery of sent ship notices | Newton | 3 |
| 52 | HubSpot demo-data loader script | Newton | 1 |
| 45 | Sprint scope knapsack | Ian | 3 |
| 46 | Sprint plan tab with confirmed apply | Ian | 3 |
| 47 | Weekly Confluence digest | Ian | 3 |
| 48 | Confluence Stakes macro | Ian | 2 |
| | **Newton 11 · Ian 11** | | |

### Sprint 5: Harden, install and record

| # | Story | Owner | Pts |
|---|---|---|---|
| 55 | Security and cost reviews on both apps | Newton | 3 |
| 57 | Production deploy and installation links | Newton | 1 |
| 60 | Record the demo video and gallery images | Newton | 5 |
| 62 | Freeze the demo dataset and tag v1.0 | Newton | 1 |
| 54 | States audit: empty, loading, error, low-confidence, not-connected | Ian | 3 |
| 56 | Integration checklist with two clean runs | Ian | 2 |
| 58 | README judge install guide with screenshots | Ian | 2 |
| 59 | Fresh-install test on the empty site | Ian | 1 |
| 61 | Devpost text and Teamwork Graph bonus write-up | Ian | 2 |
| | **Newton 10 · Ian 10** | | |

### Sprint 6: Submit and buffer

| # | Story | Owner | Pts |
|---|---|---|---|
| 64 | Submit on Devpost and verify every public link | Newton (Ian verifies links logged out) | 1 |

### Totals

| | S1 | S2 | S3 | S4 | S5 | S6 | Total |
|---|---|---|---|---|---|---|---|
| Newton | 24 | 9 | 14 | 11 | 10 | 1 | **69** + Sprint 0 site steps |
| Ian | 20 | 13 | 12 | 11 | 10 | 0 | **66** |

## 4. Where our work meets (interfaces)

Most friction in a two-person build happens at the seams. These are ours, with who defines each one. The definer merges first and the other person builds against it, using fakes until the real thing lands.

| Seam | Defined by | Used by | Lives in | Needed by |
|---|---|---|---|---|
| `EvidenceItem`, `Snapshot`, `PanelView`, `Settings`, `BacklogRow` types | Newton (first PR of Sprint 1) | Both | `packages/contracts/src/` | Sprint 1, day 1 |
| Core scoring functions (`rawSignals`, `normalise`, `score`, `suggestPriority`, `detect`, `confidence`) | Ian | Newton's `getStakes` service | `apps/stakes/src/core/` | Sprint 1, day 4 |
| Demo seed files (customers, deals, issues, requests) | Newton | Ian's calibration test | `apps/stakes/scripts/demo-data/` | Sprint 1, day 3 |
| `getStakes` resolver returning `PanelView` | Newton | Ian's panel | `src/resolvers/` | Sprint 1, day 6 (Ian uses a fixture before that) |
| `importCsv`, `seedDemo`, `removeDemo`, `getSeedStatus` resolvers | Newton | Ian's settings Data tab | `src/resolvers/` | Sprint 1, day 7 |
| `parseCsv` / `validateCsv` | Ian | Newton's `importCsv` service | `src/core/csv.ts` | Sprint 1, day 4 |
| `getStakes` and percentile services for batch scoring | Newton | Ian's backlog resolvers | `src/services/` | Sprint 2, day 1 |
| `applyPriority` resolver | Newton | Ian's backlog bulk bar (Newton wires the panel button) | `src/resolvers/` | Sprint 2, day 4 |
| `TextWriter` interface | Newton | Ian's prompts | `src/adapters/llm.ts` | Sprint 3, day 2 |
| `checkNumbers` guard | Ian | Newton's `TextWriter` | `src/core/guard.ts` | Sprint 3, day 3 |
| Ship notice entity + `getShipNotice` / `sendShipNotice` | Newton (entity, trigger) | Ian (tab, Send flow) | `src/services/shipNotice.ts` | Sprint 3, day 3 |
| Action handlers (7) | Newton | Ian's Rovo agent prompt | `src/actions/` | Sprint 3, day 4 |
| `stakes.shipNotice` property with `deliveredAt` | Contract: Newton | Bridge (Newton) | `packages/contracts` | Sprint 4 |

When you change a seam after it has merged, say so in the PR title (`feat(contracts)!: …`) and tag the other person as reviewer.

## 5. Working agreement

### Branches, PRs and the board

- Start every story from its issue so the branch is linked: `gh issue develop <n> --checkout --name feat/<slug>`.
- One story per PR where possible. The PR description has `Closes #<n>` on its own line. Use `Part of #<n>` if the PR is only a slice.
- When the PR opens, move the card to **In review** and request the other person as reviewer. **Done** is set by hand after review, never by automation.
- Review within one working day. If a review blocks you for longer, message the other person directly rather than waiting.
- Merge with squash. Keep commit titles Conventional (`feat(panel): add evidence drawer`).
- Never rebase or force-push a branch the other person has pulled. Merge `main` forward instead.

### Environments, so we don't overwrite each other

A site can only have one installation of an app, so we each use our own Forge environment **and** our own dev site.

| | Newton | Ian |
|---|---|---|
| Forge environment | `development` | `dev-ian` (`forge environments create`) |
| Dev site | Newton's existing dev site | Ian's own site from `forge site provision` |
| Empty fresh-install site | Shared, Newton holds the login | Shared |

Persisted Teamwork Graph queries may be registered per site. Until Sprint 0 confirms otherwise, Ian registers `stakes_q1_deals`, `stakes_q3_conversations` and `stakes_q5_team` on their own site too, using the steps in [`teamwork-graph.md`](teamwork-graph.md) §2.

### Daily rhythm

- A short message at the start of each day: yesterday, today, blocked on. Post it on the sprint epic or in chat, whichever we actually read.
- Anything blocking for more than half a day is raised, not sat on.
- Mid-sprint (day 3 or 4): the lead checks the "done when" test can still pass and moves stories if not.

### Definition of done (every story)

From [`development.md`](development.md) §8:

- [ ] Core logic unit-tested; service tested with fake adapters
- [ ] Adapter has happy, empty and error fixtures
- [ ] Empty, loading, error and low-confidence states implemented
- [ ] Works through `forge tunnel` on the owner's dev site with demo data
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` all pass; `forge lint` clean
- [ ] Docs updated if contracts, modules or scopes changed
- [ ] Integration checklist entry added (from Sprint 5 on, this is `docs/integration-checklist.md`)

### Hard rules both of us follow

These come from `CLAUDE.md`, and CI enforces most of them.

- `apps/stakes` declares no `permissions.external`, `remotes` or `providers`.
- Teamwork Graph is read only `asUser`, never from triggers or scheduled jobs.
- Every write to Jira happens in a resolver, after `confirmed: true`, as the approving user.
- AI writes words, never numbers.
- Logs carry ids and counts only.
- No credentials, real customer names or site URLs in the repo (use `<site>`).
- Code comments explain why, in their own words, and never reference docs, sprints or tickets.

## 6. Ian's onboarding checklist (do once, Sprint 1 day 1)

1. Accept the GitHub repo invitation (done) and the **Stakes** project board.
2. `git clone git@github.com:Wamitinewton/Stakes.git && cd Stakes && nvm use && npm ci`.
3. `npm run typecheck && npm run lint && npm test` should all pass on a clean clone.
4. Read in this order: [`PROJECT.md`](PROJECT.md) (What this is, Feature catalog, UI and design), [`architecture.md`](architecture.md), [`scoring.md`](scoring.md), then this page and [`sprints/sprint-1-evidence-and-score.md`](sprints/sprint-1-evidence-and-score.md).
5. Open the design mock-ups in `design/project/*.dc.html` in a browser (`Main`, `PanelNarrow`, `Settings`, `Backlog`, `Release`, `Customer`, `Rovo`). The UI you build should match them.
6. `npm i -g @forge/cli` (Node ≥ 22.23.4, see `.nvmrc`) and `forge login` with your own Atlassian API token.
7. **Newton:** add Ian as a contributor to both apps (`stakes`, `stakes-bridge`) in the Atlassian developer console, and confirm Ian's account can use the `graph:connector` EAP.
8. `forge site provision` for your own dev site; create the `PAY` (Scrum) and `HELP` (service management) projects.
9. `cd apps/stakes && forge environments create dev-ian && forge deploy -e dev-ian && forge install -e dev-ian --site <your-site>.atlassian.net --product jira`.
10. Open any `PAY` issue and check the Stakes hello-world panel renders. Then pick up #11.

Until steps 7–9 work, everything Ian owns in the first half of Sprint 1 (#11, #12, #14) is pure TypeScript and needs no site.
