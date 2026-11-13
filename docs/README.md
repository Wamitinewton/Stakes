# Stakes technical documentation

Stakes is a Forge app for Jira that shows what is riding on every work item (customers, deal value, support pressure, conversations, goals), ranks work by that evidence, and closes the loop with sales and support when the work ships.

These docs are the engineering view of the product. [`PROJECT.md`](PROJECT.md) is the product brief: why, for whom, scope and schedule. Everything here describes **how** it is built. Where the two disagree, the brief wins on scope and these docs win on implementation detail, and the disagreement gets fixed in the same pull request.

## Reading order

| # | Document | Read it when you need to know |
|---|---|---|
| 1 | [PROJECT.md](PROJECT.md) | What we are building, for whom, and by when |
| 2 | [architecture.md](architecture.md) | How the pieces fit: layers, request flows, the two-app split |
| 3 | [tech-stack.md](tech-stack.md) | Which languages, SDKs and tools, and why (including why not Next.js) |
| 4 | [scoring.md](scoring.md) | The Stakes Score: signals, normalisation, formula, detection rules, a worked example |
| 5 | [data-model.md](data-model.md) | Entity store, KVS keys, issue properties, shared TypeScript contracts |
| 6 | [teamwork-graph.md](teamwork-graph.md) | Connector objects (write side) and curated queries (read side) |
| 7 | [ai-layer.md](ai-layer.md) | Forge LLM usage, prompts, the numeric guard, budget and cache |
| 8 | [api-reference.md](api-reference.md) | Every resolver, Rovo action and MCP tool, with inputs and outputs |
| 9 | [forge-modules.md](forge-modules.md) | Manifest modules and scopes for both apps |
| 10 | [security.md](security.md) | Permissions, data handling, threat model, cost controls |
| 11 | [development.md](development.md) | Setup, daily workflow, testing, CI/CD, conventions |
| — | [adr/](adr/) | Architecture decision records |
| — | [WORKSPLIT.md](WORKSPLIT.md) | Who owns what between Newton and Ian, and how we work together |
| — | [sprints/](sprints/README.md) | Detailed guide for each sprint: stories, owners, order, hand-offs, review checklist |

## Status markers

Several Forge capabilities Stakes depends on (`graph:connector`, the Teamwork Graph API, `rovo:mcp`, Forge LLMs) are in Preview or EAP. Anything not yet verified against a real site is marked:

> **Unverified:** confirm during the Phase 0 spike.

Remove the marker when the behaviour is confirmed, and record what was learned in the relevant doc or ADR.

## Conventions for these docs

- One topic per file. Link instead of repeating.
- Code identifiers in backticks, exactly as they appear in the code.
- Diagrams in Mermaid so they render on GitHub and stay diffable.
- No credentials, real customer names or real site URLs. Use `<site>`, `<appId>` placeholders.
