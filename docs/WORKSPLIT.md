# Work split: Newton and Ian

Stakes is built by two people from **14 November to 22 December 2026**. **Each sprint is built end to end by one person**, who owns every story in it, from core logic through to UI and site verification. The other person reviews. The detailed guide for each sprint is in [`sprints/`](sprints/README.md).

| Person | GitHub | Owns |
|---|---|---|
| **Newton** | `Wamitinewton` | Sprint 0, Sprint 1, Sprint 3, Sprint 6 |
| **Ian** | `Dancan254` | Sprint 2, Sprint 4, Sprint 5 |

## 1. Who owns which sprint

| Sprint | Dates | Epic | Owner | Reviewer | Pts | Guide |
|---|---|---|---|---|---|---|
| 0 Foundation and spikes | Nov 10–13 | #1 | Newton | — | (done) | [sprint-0-foundation.md](sprints/sprint-0-foundation.md) |
| 1 Evidence and score | Nov 14–22 | #10 | **Newton** | Ian | 44 | [sprint-1-evidence-and-score.md](sprints/sprint-1-evidence-and-score.md) |
| 2 Decide | Nov 23–29 | #24 | **Ian** | Newton | 22 | [sprint-2-decide.md](sprints/sprint-2-decide.md) |
| 3 Loop and AI | Nov 30–Dec 6 | #33 | **Newton** | Ian | 26 | [sprint-3-loop-and-ai.md](sprints/sprint-3-loop-and-ai.md) |
| 4 Plan, Confluence and bridge | Dec 7–13 | #44 | **Ian** | Newton | 22 | [sprint-4-plan-confluence-bridge.md](sprints/sprint-4-plan-confluence-bridge.md) |
| 5 Harden, install and record | Dec 14–19 | #53 | **Ian** | Newton | 20 | [sprint-5-harden-install-record.md](sprints/sprint-5-harden-install-record.md) |
| 6 Submit and buffer | Dec 20–22 | #63 | **Newton** | Ian | 1 | [sprint-6-submit.md](sprints/sprint-6-submit.md) |
| | | | | | **Newton 71 · Ian 64** | |

Every story in a sprint is assigned to that sprint's owner on the board.

## 2. Why this assignment

- **Sprint 1 → Newton.** It is almost all graph, connector, Jira REST and storage work on the dev site, and it depends on finishing the Sprint 0 site steps and the ADR-0001 gate, which Newton started. It also gives Ian time to get Forge access before their first sprint.
- **Sprint 2 → Ian.** The backlog page is a self-contained React + Vite + Atlaskit app, sitting on top of the `getStakes` service from Sprint 1. It's a good first sprint: a clear surface and a clear demo (Journey A).
- **Sprint 3 → Newton.** Product triggers, Forge LLMs, Rovo and `rovo:mcp` are the Preview features Newton already proved in the Sprint 0 spikes.
- **Sprint 4 → Ian.** Planning, Confluence and the bridge app are each independent of the others, and Ian can set up their own HubSpot and Slack accounts during Sprint 3.
- **Sprint 5 → Ian.** Testing, install and the submission materials benefit from someone who didn't build Sprints 1 and 3, the biggest part of the code.
- **Sprint 6 → Newton.** Newton submits; Ian independently checks every public link.
- Points come out roughly even (71 vs 64), and nobody owns two sprints in a row until Sprints 4–5. Sprint 5 depends on Sprint 4's bridge, so keeping both with the same person avoids a handover in the final week.

## 3. The off-sprint person

While one person builds a sprint, the other:

1. **Reviews every PR within one working day.** Same day in Sprints 5 and 6.
2. **Fixes bugs in their own earlier sprints.** If the owner finds a bug in code delivered by a previous sprint, it goes back to whoever built that sprint, so the current owner keeps moving. Sprint 5 is the exception: Ian fixes whatever the audits find, so nothing waits during the last week.
3. **Prepares their next sprint**, using work that doesn't depend on the sprint in progress: reading the guide, setting up accounts, recording fixtures, and starting pure or scaffold work. Each guide's "What … does during this sprint" section lists exactly what's safe to start.
4. **Watches the done-when demo** at sprint review.

They don't pick up stories from the running sprint. If the owner is stuck, the off-sprint person pairs on it but doesn't take the card. If a story genuinely has to move, the owner moves it to the next sprint and writes that on the epic.

## 4. Handover between sprints

At the end of each sprint, the owner posts a **handover note** as a comment on the epic before closing it, and walks the next owner through it (30 minutes is enough). The note covers:

- What shipped, with PR links
- What didn't, and which sprint it moved to
- The services, resolvers and types the next sprint builds on, and where they live
- Anything surprising on the dev site (limits hit, Preview API behaviour, flaky steps)
- How to reset the demo data

The next sprint's guide starts with "Read the handover note".

## 5. Working agreement

### Branches, PRs and the board

- Start every story from its issue so the branch is linked: `gh issue develop <n> --checkout --name feat/<slug>`.
- One story per PR where possible. The PR description has `Closes #<n>` on its own line. Use `Part of #<n>` if the PR is only a slice.
- When the PR opens, move the card to **In review** and request the other person as reviewer. **Done** is set by hand after review, never by automation.
- Merge with squash. Keep commit titles Conventional (`feat(panel): add evidence drawer`).
- Never rebase or force-push a branch the other person has pulled. Merge `main` forward instead.
- At sprint start, the owner moves that sprint's cards from Backlog to Todo.

### Environments

A site can hold only one installation of an app, so we each use our own Forge environment **and** our own dev site.

| | Newton | Ian |
|---|---|---|
| Forge environment | `development` | `dev-ian` (`forge environments create`) |
| Dev site | Newton's existing dev site | Ian's own site from `forge site provision` |
| Empty fresh-install site | Shared | Shared |
| Production deploy rights | Yes | Granted by Newton during Sprint 4 (needed for Sprint 5) |

The done-when demo for a sprint runs on the **owner's** dev site. Persisted Teamwork Graph queries may be registered per site. Until Sprint 0 confirms otherwise, Ian registers `stakes_q1_deals`, `stakes_q3_conversations` and `stakes_q5_team` on their own site too, following [`teamwork-graph.md`](teamwork-graph.md) §2.

### Daily rhythm

- A short message on the running sprint's epic each day: yesterday, today, blocked on.
- Anything blocking for more than half a day is raised, not sat on.
- Mid-sprint (day 3 or 4), the owner checks the done-when demo can still pass, and cuts P2, then P1, stories if not.

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

## 6. Ian's onboarding checklist (during Sprint 1, before Sprint 2 starts on Nov 23)

1. Accept the GitHub repo invitation (done) and open the **Stakes** project board.
2. `git clone git@github.com:Wamitinewton/Stakes.git && cd Stakes && nvm use && npm ci`.
3. `npm run typecheck && npm run lint && npm test` should all pass on a clean clone.
4. Read in this order: [`PROJECT.md`](PROJECT.md) (What this is, Feature catalog, UI and design), [`architecture.md`](architecture.md), [`scoring.md`](scoring.md), then this page and [`sprints/sprint-2-decide.md`](sprints/sprint-2-decide.md).
5. Open the design mock-ups in `design/project/*.dc.html` in a browser, especially `Backlog`, `Release` and `Customer` for Sprint 2.
6. `npm i -g @forge/cli` (Node ≥ 22.23.4, see `.nvmrc`) and `forge login` with your own Atlassian API token.
7. **Newton:** add Ian as a contributor to both apps (`stakes`, `stakes-bridge`) in the Atlassian developer console, and confirm Ian's account can use the `graph:connector` EAP.
8. `forge site provision` for your own dev site; create the `PAY` (Scrum) and `HELP` (service management) projects.
9. `cd apps/stakes && forge environments create dev-ian && forge deploy -e dev-ian && forge install -e dev-ian --site <your-site>.atlassian.net --product jira`.
10. Review Newton's Sprint 1 PRs as they come in. That's the fastest way to learn the code you'll build on.
11. Prepare Sprint 2: scaffold `static/backlog/` and build the ranking table against a fixture `BacklogRow[]` (see the Sprint 1 guide, "What Ian does during this sprint").
