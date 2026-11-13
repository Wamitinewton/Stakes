# Sprint 5: Harden, install and record

| | |
|---|---|
| **Dates** | Sun Dec 14 – Fri Dec 19, 2026 (6 days) |
| **Epic** | #53 |
| **Owner** | **Ian**: builds every story end to end |
| **Reviewer** | Newton: reviews every PR within a working day; watches the video cut before it goes public |
| **Load** | 20 pts |
| **Features** | No new features. Quality, install and submission material |

## Goal

Stakes installs cleanly on an empty site, survives every failure state, and the submission materials are recorded.

**Done when:** the final checklist in [`../PROJECT.md`](../PROJECT.md#final-checklist) is fully ticked, apart from "Submitted by December 20", which is Sprint 6:

- [ ] Public YouTube video under three minutes, captions on, no copyrighted music
- [ ] Installation links tested from a logged-out browser on the empty site
- [ ] README with install guide, architecture diagram, score formula, data-handling statement
- [ ] Public GitHub repository with licence and `skill.md`
- [ ] `forge eligibility` clean for `stakes`
- [ ] Devpost form complete (draft saved): category Business Teams, bonus Teamwork Graph, all text fields, gallery images
- [ ] Explanation of how the project meets the technology requirement

**Feature freeze starts on Dec 14.** From now on, only fixes for bugs found by this sprint's audits are merged. New ideas go into a "What's next" list for the Devpost text.

## Ordering matters this sprint

The video must be recorded from the build that gets tagged `v1.0`, and that build must already have passed the states audit, the security review and two clean integration runs. So:

```
States audit (#54) ─┐
Security/cost (#55) ┼─► Integration run ×2 (#56) ─► Prod deploy (#57) ─► Fresh install (#59) ─► Freeze + v1.0 (#62) ─► Record video (#60)
                    │                                                     README guide (#58) ──┘
Devpost text (#61) runs in parallel the whole sprint
```

## Stories at a glance

| # | Story | Pts | Prio | Depends on |
|---|---|---|---|---|
| 54 | States audit: empty, loading, error, low-confidence, not-connected | 3 | P0 | — |
| 55 | Security and cost reviews on both apps | 3 | P0 | — |
| 56 | Integration checklist with two clean runs | 2 | P0 | 54, 55 fixes merged |
| 57 | Production deploy and installation links | 1 | P0 | 56 |
| 58 | README judge install guide with screenshots | 2 | P0 | 57 (for the screenshots) |
| 59 | Fresh-install test on the empty site | 1 | P0 | 57, 58 |
| 62 | Freeze the demo dataset and tag v1.0 | 1 | P1 | 59 |
| 60 | Record the demo video and gallery images | 5 | P0 | 62 |
| 61 | Devpost text and Teamwork Graph bonus write-up | 2 | P0 | — |

## Suggested order

Twenty points in six days is tight, and the chain above can't be reordered, so every day counts. Ian needs production deploy rights on both Forge apps before Sun 14; Newton grants them during Sprint 4.

| Day | Ian |
|---|---|
| Sun 14 | #54 walk every surface through every state; file bugs. Start #55 security-review and cost-optimizer runs, secret scan of history |
| Mon 15 | #54 fix gaps. #55 fix high findings. Write `docs/integration-checklist.md`. Video shot list |
| Tue 16 | #56 run 1 and run 2 on the dev site. #57 production deploy + installation links |
| Wed 17 | #58 README with screenshots from the prod install. #59 timed fresh install. #61 draft |
| Thu 18 | #62 freeze + tag. #60 record |
| Fri 19 | #60 edit, captions, upload unlisted → Newton reviews → public. #61 finish; save the Devpost draft; gallery captions. Final checklist walk-through; close the epic |

## Fixes found by the audits

The states audit and the security review will find bugs in code from every sprint. In earlier sprints a bug in delivered work goes back to whoever built that sprint. **In this sprint only, Ian fixes everything the audits find**, so nothing waits in someone else's queue during the last week. Newton is available to explain Sprint 1 and Sprint 3 code, and reviews every fix.

## What Newton does during this sprint

Newton reviews every fix PR the same day (turnaround matters most this week), answers questions about Sprint 1 and Sprint 3 code, watches the unlisted video before it goes public, and prepares Sprint 6: confirming both names are on the Devpost team and the submission account is ready.

---

### #54 States audit: empty, loading, error, low-confidence, not-connected (3 pts)

Walk **every surface** through **every state** and fix the gaps. Record the results as a matrix on the issue.

| Surface ↓ / State → | Loading | No evidence | Low confidence | Graph unavailable | LLM off/budget | No permission | Confluence not connected | Bridge not installed |
|---|---|---|---|---|---|---|---|---|
| Issue panel | | | | | | | — | |
| Ship notice tab | | | — | — | | | — | |
| Context badge | | | — | — | — | | — | — |
| Backlog tab | | | | | — | | — | — |
| Releases tab | | | — | | — | | — | — |
| Customers tab | | | — | | — | | — | — |
| Sprint plan tab | | | — | — | — | | — | — |
| Settings (each tab) | | | — | — | | NOT_ADMIN | | |
| Confluence macro | | | — | | — | | n/a | — |
| Rovo agent / MCP | — | | | | — | | — | — |

How to force each state: clear snapshots (loading); an issue with no links (no evidence); remove the graph scopes in a dev deploy, or make the reader return degraded (graph unavailable); budget 0 (LLM); a test user without access to `HELP` (no permission); an installation without Confluence.

**Acceptance criteria**
- [ ] No blank panels or raw errors anywhere
- [ ] Every empty or error state says what to do next

---

### #56 Integration checklist with two clean runs (2 pts)

The checklist is written to be followed by a stranger. Write it, then run it strictly as written, with no steps from memory.

**Build:** `docs/integration-checklist.md`, a numbered, tickable script that a stranger could follow, covering:
1. Install `stakes` (Jira, then Confluence) and `stakes-bridge`
2. Create `PAY` and `HELP`; *Load demo data*
3. Journey A (backlog, apply priorities, sprint plan)
4. Panel on the four hero issues; evidence links open
5. JQL on the score field
6. Journey C: Done, release, Send, JSM replies, Slack within 5 minutes
7. Journey B: the four Rovo questions; MCP from Claude Code
8. Digest and macro
9. HubSpot edit → *Sync now* → score change
10. *Remove demo data*; check nothing is left

Then run it **twice in a row** on the dev site, with no code or data fixes in between. If run 1 needs a fix, fix it, then do two fresh runs.

**Acceptance criteria**
- [ ] Both runs pass with no manual fixes in between

---

### #58 README judge install guide with screenshots (2 pts)

**Build:** rewrite `README.md` for a judge who has never heard of Stakes:
- One-paragraph pitch and the hero screenshot (`PAY-142` panel)
- **Install guide**, following `PROJECT.md` "Judge install guide": org-admin site, installation link, scopes approval, optional Confluence, create `PAY` and `HELP`, *Load demo data*, where to look, the optional Rovo, MCP, ship notice and bridge steps, clean-up
- A screenshot of **every approval screen** (from the production install)
- Architecture diagram (Mermaid, plus an exported PNG for Devpost)
- Score formula with the `PAY-142` worked example
- Data-handling statement: what is stored where, no egress from `stakes`, what the bridge sends, how to delete everything
- If persisted graph queries are per site, the steps for the judge to register them, or a clear note that the mirror covers deals without them
- Links to `skill.md`, `docs/`, the licence

Store screenshots in `docs/install-guide/` (no real names or site URLs visible).

**Acceptance criteria**
- [ ] A friend installs from the guide without help

---

### #59 Fresh-install test on the empty site (1 pt)

On the empty demo site that has never had Stakes, from a fresh browser profile: start a stopwatch, open the production installation link, then follow the README exactly through *Load demo data* and opening `PAY-142`. Write down every place you hesitated and fix the README for each.

**Acceptance criteria**
- [ ] Under 10 minutes with no errors

Then uninstall, so the site is empty again for Sprint 6's logged-out check.

---

### #61 Devpost text and Teamwork Graph bonus write-up (2 pts)

**Build:** a draft of every Devpost field in `docs/submission/devpost.md` (so we can both review it in a PR), then paste it into the Devpost draft. Follow the outline in `PROJECT.md` "Submission package":
- Tagline: *Know what's riding on every work item.*
- Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next
- Built with: forge, typescript, react, atlaskit, teamwork-graph, rovo, mcp, forge-llms
- **Teamwork Graph bonus write-up:** what both connectors push (customer orgs, deals, associations to work items), which relationships Stakes queries back (Q1–Q5 with their final kind: curated or persisted), and why using both directions matters. Use the real outcomes from ADR-0001 and `teamwork-graph.md`, and be honest about what came from the mirror.
- Technology requirement explanation
- Gallery image captions (images come from #60)

**Acceptance criteria**
- [ ] Category Business Teams, bonus Teamwork Graph selected

---

### #55 Security and cost reviews on both apps (3 pts)

**Do**
- Run the Forge security-review and cost-optimizer skills on `apps/stakes` and `apps/stakes-bridge`; fix every high finding and log the rest on the issue.
- Secret-scan the full git history (e.g. `gitleaks detect --log-opts="--all"`).
- `git grep` for real-looking names, `atlassian.net` hosts, emails and token prefixes.
- Manual check: a user without access to `HELP` opens `PAY-142` and sees no `HELP` request titles.
- Check every write resolver requires `confirmed: true`, and every resolver that takes an `issueKey` calls `canView` first.
- Tick the checklist in `docs/security.md` §5.

**Acceptance criteria**
- [ ] Pre-submission checklist in docs/security.md §5 ticked

---

### #57 Production deploy and installation links (1 pt)

**Do:** run the production `workflow_dispatch` (or `forge deploy -e production` for both apps), then generate installation links for `stakes` (Jira + Confluence) and `stakes-bridge`. Open each link from a logged-out browser and confirm it reaches the consent screen. Put the links in the README.

**Acceptance criteria**
- [ ] Links work from a logged-out browser

**Trap:** any later scope change means regenerating the links and re-taking the consent screenshots, which is one more reason for the feature freeze.

---

### #62 Freeze the demo dataset and tag v1.0 (1 pt)

**Do:** after #59 passes, lock `scripts/demo-data/` (no edits without both of us agreeing), confirm `score.demo.test.ts` passes, and tag the commit the production deploy came from: `git tag -a v1.0 -m "Codegeist submission build"` → push the tag. The video is recorded from exactly this build.

**Acceptance criteria**
- [ ] `v1.0` tag points at the recorded build

---

### #60 Record the demo video and gallery images (5 pts)

**Do:** follow the 2:55 script in `PROJECT.md` "Submission package". Its eight segments run from "This bug is marked Low…" to the architecture diagram.
- Rehearse on a freshly seeded dev site; record each segment separately; narrate after.
- Captions burned in or uploaded as an SRT; royalty-free music or none.
- Export 5–8 gallery images: backlog with silent fire, panel with evidence drawer, apply confirmation + audit comment, ship notice + Slack message, Rovo chat, Claude Code MCP call, Confluence digest, architecture.
- Upload to YouTube as unlisted for Newton to review, then switch it to public.

**Acceptance criteria**
- [ ] Public on YouTube, captions on, no copyrighted music

---

## Sprint review checklist (owner: Ian, with Newton watching)

- [ ] States matrix complete, every cell passing
- [ ] Security §5 ticked; no high findings open
- [ ] Two consecutive clean integration runs recorded
- [ ] Production links work logged out
- [ ] Fresh install under 10 minutes with the README alone
- [ ] `v1.0` tagged; video public with captions; gallery images exported
- [ ] Devpost draft saved with all fields, category and bonus selected
- [ ] Repository public, licence and `skill.md` present
- [ ] Epic #53 closed
