# Sprint guides

One file per sprint. Each guide says what the sprint must prove, who owns each story, what to build in which files, how the two owners hand work to each other, and how to check it on a real site. Read [`../WORKSPLIT.md`](../WORKSPLIT.md) first for the ownership rules and the working agreement.

| Sprint | Dates | Epic | Lead | Proves | Guide |
|---|---|---|---|---|---|
| 0 | Nov 10–13 | #1 | Newton | Workspace, CI, both apps and every Preview/EAP dependency tried on a real site | [sprint-0-foundation.md](sprint-0-foundation.md) |
| 1 | Nov 14–22 | #10 | Newton | *Load demo data* makes `PAY-142` show score 89 with every number linking to a source | [sprint-1-evidence-and-score.md](sprint-1-evidence-and-score.md) |
| 2 | Nov 23–29 | #24 | Ian | Journey A end to end; `"Stakes Score[Number]" >= 55` returns `PAY-142` | [sprint-2-decide.md](sprint-2-decide.md) |
| 3 | Nov 30–Dec 6 | #33 | Newton | Journeys B and C end to end; 0 invented numbers in 20 AI samples | [sprint-3-loop-and-ai.md](sprint-3-loop-and-ai.md) |
| 4 | Dec 7–13 | #44 | Ian | HubSpot edit changes `PAY-142` after *Sync now*; ship notice in Slack < 5 min; digest page in Confluence | [sprint-4-plan-confluence-bridge.md](sprint-4-plan-confluence-bridge.md) |
| 5 | Dec 14–19 | #53 | Ian | The final checklist in `PROJECT.md` is fully ticked | [sprint-5-harden-install-record.md](sprint-5-harden-install-record.md) |
| 6 | Dec 20–22 | #63 | Newton | Submitted on Devpost Dec 20; all public links verified logged out | [sprint-6-submit.md](sprint-6-submit.md) |

Hard deadline: **22 December 2026, 12:00 PT (23:00 Nairobi)**. Internal target: submit on 20 December.

## How to read a guide

Every guide has the same shape:

1. **Goal and done-when.** The single demo that must pass on the dev site at sprint review. Vitest passing is not enough.
2. **Starting point.** What already exists in the repo when the sprint opens.
3. **Stories at a glance.** Owner, points, priority and dependencies.
4. **Suggested order.** A day-by-day plan for each person, built around the hand-offs.
5. **Story details.** For each story: what to build, which files, the interface it exposes or consumes, acceptance criteria (copied from the issue), tests, how to verify on a site, and known traps.
6. **Sprint review checklist.** What the lead runs through before closing the sprint.

## The four user journeys the sprints build towards

- **A, Monday triage (Amina, PM).** Backlog page → spots silent fire `PAY-142` and phantom `PAY-150` → bulk-applies suggested priorities with confirmation → accepts a sprint scope. *Built in Sprints 1–2, sprint plan in 4.*
- **B, Account review (Brian, CSM).** Asks the Rovo agent "What is Kilima Freight waiting on?" → gets issues, owners, versions → asks for a status note. *Sprint 3.*
- **C, The fix ships (everyone).** `PAY-142` → Done, `2026.12` released → ship notice drafted → Amina clicks Send → owners @mentioned and messaged in Slack, JSM requests get replies → digest lists it. *Sprints 3–4.*
- **D, Setup (Admin).** Install → approve scopes → connect HubSpot, upload CSV or *Load demo data* → review weights → save. *Sprints 1, 4, 5.*

## Board conventions

- Project: **Stakes** (GitHub Projects, owner `Wamitinewton`). Each story card carries `Sprint` (iteration), `Priority` (P0 must ship, P1 should ship, P2 cut first), `App`, `Estimate` and an assignee.
- Statuses: Backlog → Todo (sprint started) → In progress → In review (PR open) → Done (set by hand after review).
- Epics close at sprint review, not when their sub-issues close.
- If a P0 story is at risk mid-sprint, the lead cuts or defers P2 stories first, then P1, and writes that down on the epic.
