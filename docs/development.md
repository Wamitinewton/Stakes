# Development guide

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | Matches the Forge runtime |
| npm | 10+ | Workspaces |
| Forge CLI | latest | `npm i -g @forge/cli`, then `forge login` |
| Atlassian account | — | Organization admin on the dev site (graph scopes need it) |
| Forge demo sites | 2 | `forge site provision`: one for development, one kept empty for fresh-install tests |
| HubSpot developer account, Slack workspace + bot | — | Bridge only |

## 2. Repository layout

```
stakes/
├── package.json            # workspaces: apps/*, packages/*
├── packages/contracts/     # shared zod schemas + types for issue properties
├── apps/stakes/            # core app (no egress)
│   ├── manifest.yml
│   ├── prompts/            # agent.md, llm/*.md
│   ├── src/{core,adapters,services,resolvers,actions,triggers,frontend}/
│   ├── static/backlog/     # Custom UI (React + Vite + Atlaskit)
│   ├── scripts/            # seed.ts, demo-data/
│   └── test/
├── apps/stakes-bridge/     # optional app (HubSpot, Slack)
└── docs/
```

## 3. First-time setup

```bash
npm ci
cd apps/stakes
forge register              # once; writes app id into manifest.yml
forge deploy -e development
forge install -e development --site <site>.atlassian.net --product jira
forge install -e development --site <site>.atlassian.net --product confluence   # optional
```

Repeat `register`/`deploy`/`install` for `apps/stakes-bridge` when Phase 4 starts.

## 4. Daily loop

There is no local Forge runtime. Most work happens in pure tests; the rest runs against the dev site through the tunnel.

| Task | Command |
|---|---|
| Core and contract tests (no site) | `npm test -w apps/stakes` |
| Watch tests | `npm run test:watch -w apps/stakes` |
| Type-check everything | `npm run typecheck` |
| Lint (includes layer rules) | `npm run lint` |
| Live backend + UI Kit against the site | `cd apps/stakes && forge tunnel` |
| Custom UI dev server (inside tunnel) | `npm run dev -w apps/stakes/static/backlog` |
| Logs | `forge logs -e development` |
| After a manifest change | `forge deploy -e development && forge install --upgrade -e development` |

Suggested order for any feature: write the core function and its tests → service with fake adapters and tests → adapter with contract fixtures → entry point → UI → verify on site.

## 5. Testing

| Level | Location | Tool | Target |
|---|---|---|---|
| Unit | `test/core/` | Vitest | > 90% line coverage of `src/core` |
| Service | `test/services/` | Vitest + fake adapters | Every use case: happy, degraded, empty |
| Contract | `test/adapters/` + `test/fixtures/` | Vitest + recorded JSON | Happy, empty and error fixture for every graph query, REST call, HubSpot and Slack response |
| Cross-app contract | both apps | Vitest | Round-trip every `packages/contracts` schema |
| Integration | `docs/integration-checklist.md` | Manual + `forge logs` | Full list passes twice in a row before each milestone tag |
| Fresh install | empty demo site | Manual, timed | < 10 minutes |
| AI quality | sampled outputs | Manual | 0 invented facts in 20 |

Fixtures are recorded from the real dev site, then scrubbed of names and site URLs before commit.

## 6. CI/CD (GitHub Actions)

**On every pull request**, no site needed:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint` (ESLint with boundaries) and `prettier --check`
4. `npm test -- --coverage` (fails below thresholds)
5. `forge lint` in both apps
6. `forge eligibility` in `apps/stakes`
7. Secret scan

**On push to `main`:** `forge deploy -e development --non-interactive` for both apps, using `FORGE_EMAIL` and `FORGE_API_TOKEN` repository secrets.

**Production:** manual `workflow_dispatch`, submission week only. Regenerate installation links if scopes changed.

## 7. Conventions

- **Branches:** `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Start from the issue: `gh issue develop <n> --checkout --name feat/<slug>`.
- **Commits:** Conventional, short: `feat(score): add urgency decay`. Scopes match folders or features (`score`, `panel`, `backlog`, `graph`, `llm`, `bridge`, `seed`).
- **PRs:** closing keywords in the description, one per line (`Closes #12`). Move the board card to *In review* when the PR opens.
- **Tags:** `v0.x` at each phase milestone, `v1.0` at freeze.
- **Code comments** explain why, in their own words. No references to docs sections, sprints or tickets.
- **ADRs** for any decision that changes architecture, in `docs/adr/`, numbered sequentially, using the template.
- **Naming:** graph operations `stakes_qN_<name>`; resolvers camelCase verbs; action keys kebab-case; MCP tools `stakes_<snake_case>`.

## 8. Definition of done (per feature)

- [ ] Core logic unit-tested; service tested with fakes
- [ ] Adapter has happy/empty/error fixtures
- [ ] Empty, loading, error and low-confidence states implemented
- [ ] Works through `forge tunnel` on the dev site with demo data
- [ ] `forge lint` and `forge eligibility` clean
- [ ] Docs in this folder updated if contracts, modules or scopes changed
- [ ] Integration checklist entry added
