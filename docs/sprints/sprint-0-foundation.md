# Sprint 0: Foundation and spikes

| | |
|---|---|
| **Dates** | Nov 10–13, 2026 |
| **Epic** | #1 |
| **Owner** | **Newton** (Ian joined at the end of this sprint) |

## Goal

The workspace, CI and both Forge apps exist, and every Preview/EAP dependency (`graph:connector`, Teamwork Graph API, Forge LLMs, Rovo actions, `rovo:mcp`, multi-product Confluence) has been tried on a real site.

**Done when:** every spike below is ticked or has a written fallback, and the Nov 13 gate decision (mirror primary or fallback) is recorded in ADR-0001 and `CLAUDE.md`.

## What was built

| # | Story | PR | Status |
|---|---|---|---|
| 2 | Scaffold npm workspace with both apps and shared contracts package | #65 | Merged |
| 3 | CI pipeline: typecheck, lint, test, forge lint and forge eligibility | #66 | Merged |
| 4 | Register both Forge apps and deploy a hello-world issue panel | #67 | Merged; site steps open |
| 9 | Spike: add Confluence as an optional product | #68 | Merged; site steps open |
| 7 | Spike: one Forge LLM call end to end | #69 | Merged; site steps open |
| 8 | Spike: one Rovo action and a `rovo:mcp` hello world | #70 | Merged; site steps open |
| 5 | Spike: push a customer and deal through a connector and read them back | #71 | Merged; site steps open |
| 6 | Spike: curated or persisted queries Q2–Q5 and fixtures | #72 | Merged; site steps open |

What exists in the repo now:

- `apps/stakes`, `apps/stakes-bridge`, `packages/contracts` with TypeScript strict, ESLint layer rules (tested in `apps/stakes/test/architecture`), Prettier and Vitest.
- `.github/workflows/ci.yml`: typecheck, lint, format, coverage, an egress check on `apps/stakes`, `forge lint` and `forge eligibility`.
- `apps/stakes/manifest.yml` with the issue panel, `stakes-crm` connector, one Rovo agent, one action and the LLM module.
- Adapters from the spikes: `connector.ts` (customer and deal object mapping, push summary), `graph.ts` (response classification into ok/degraded), `graph.queries.ts` (Q3, Q4, Q5 query text), `llm.ts` and `llm.models.ts`, `jira.ts` (issue basics), `storage.ts` (connector connection id).
- Graph fixtures for Q3–Q5 in `apps/stakes/test/fixtures/graph/` (synthetic until replaced by recorded ones).
- Packages: `@stakes/contracts` with issue-key validation and property keys.

## Carry-over: site steps still open (Newton, finish by Nov 15)

These need `forge login` and the demo sites. They do **not** block Ian's Sprint 1 start, which is pure TypeScript, but they do block #18 and #20.

- [ ] `forge login`, provision the dev site and the empty fresh-install site (#4)
- [ ] Deploy and install `stakes` on the dev site; the hello panel renders on a `PAY` issue; `forge eligibility` reports nothing (#4)
- [ ] Install `stakes` on Confluence on the same installation; `forge lint` accepts the compatibility keys (#9)
- [ ] Payment method in the developer console; *Run LLM check* returns text; record usage numbers from `forge logs` (#7)
- [ ] Rovo agent answers using `get-issue-stakes`; external MCP enabled; Claude Code lists and calls the tool (#8)
- [ ] Run the `connectorSpike` resolver: push one customer and one deal linked to a `PAY` issue, try the `stakes_q1_deals` read-back, screenshot Rovo Search (#5)
- [ ] Register `stakes_q1_deals`, `stakes_q3_conversations`, `stakes_q5_team` as persisted queries in the explorer; record real happy/empty/error fixtures, scrubbed (#6)
- [ ] Find out whether persisted queries are per site or per app, and write it into `docs/teamwork-graph.md` §2. Ian needs to know whether to register them on their own site, and the install guide needs to know too.
- [ ] **Gate:** fill in ADR-0001's spike evidence and decision, set its status to Accepted, update the Decisions section in `CLAUDE.md` and `docs/teamwork-graph.md` §5
- [ ] Add Ian as a contributor on both apps in the developer console
- [ ] Edit PRs #67–#72 from `Part of` to `Closes` where the site steps are now done

The docs currently lean towards **mirror primary**: deals and customers come from the entity-store mirror and `stakesBridge.crm`, while the graph supplies Q2–Q5 and Rovo Search. Sprint 1 is designed to work with either outcome, because the evidence collector always walks the chain graph → bridge property → mirror.

## Sprint review

- [ ] Every item above ticked, or a written fallback recorded on the issue
- [ ] ADR-0001 accepted
- [ ] Epic #1 closed with a short note of what was learned
