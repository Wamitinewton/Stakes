# Tech stack

## Summary

| Layer | Choice | Why |
|---|---|---|
| Platform | Atlassian Forge | Hosted compute, storage and auth inside Jira and Confluence; required for Codegeist and for Runs on Atlassian |
| Runtime | Node.js 22 (`nodejs22.x`) | Current Forge runtime |
| Language | TypeScript, `strict: true` | One language across backend, UI and the cross-app contract |
| Monorepo | npm workspaces | Two apps plus a shared `packages/contracts`, no extra tooling |
| Backend | Forge functions + `@forge/resolver` | The only backend Forge offers; no server to run |
| Small UIs | UI Kit (`@forge/react`) | Native Atlassian components, no bundler, fastest to build |
| Backlog page | Custom UI: React 18 + Vite + Atlaskit | Needs tables, drawers, filters and charts beyond UI Kit |
| Charts | Recharts | Sparklines and score bars in the Custom UI |
| Storage | Forge KVS + custom entity store (`@forge/kvs`) | Data-residency-enabled, no egress, indexed queries |
| Secrets | Forge secret storage | Bridge tokens only |
| AI | Forge LLMs (`@forge/llm`) | Claude models hosted by Atlassian, no egress |
| Graph | `@forge/teamwork-graph` + `requestTeamworkGraph` | Connector writes and curated query reads |
| Validation | zod | Runtime validation for resolver inputs, CSV rows and issue properties; types inferred from the same schema |
| Tests | Vitest + coverage (v8) | Fast, TypeScript-native |
| Lint/format | ESLint, `eslint-plugin-boundaries`, Prettier, `forge lint` | Layer rules enforced as errors |
| CI/CD | GitHub Actions | Lint, test, `forge lint`, `forge eligibility`, deploy to development |

## Forge SDK packages

| Package | Used in | Purpose |
|---|---|---|
| `@forge/api` | `adapters/` | `asUser()` / `asApp()`, `requestJira`, `requestConfluence`, `route` template tag |
| `@forge/resolver` | `resolvers/` | Defines resolver functions the UI calls |
| `@forge/kvs` | `adapters/storage.ts` | KVS, custom entity store, secrets |
| `@forge/llm` | `adapters/llm.ts` | Forge LLM chat calls |
| `@forge/teamwork-graph` | `adapters/connector.ts`, `adapters/graph.ts` | Connector object push; graph reads |
| `@forge/events` | `triggers/` | Async event queue if a job needs to fan out |
| `@forge/bridge` | `frontend/`, `static/backlog/` | `invoke()` resolvers, `router`, `view`, `requestTeamworkGraph` |
| `@forge/react` | `frontend/` | UI Kit components |

> **Unverified:** exact package names and call shapes for `@forge/llm` and `@forge/teamwork-graph` are Preview/EAP. Confirm with the Forge MCP server and `forge lint` when each is added.

## Why not Next.js

Next.js is a server framework. Its value is server rendering, API routes and its own router. In a Forge app:

- There is nowhere to run a Next.js server. Forge runs functions, not long-lived Node servers.
- Hosting Next.js elsewhere means a Forge `remote`, which costs `stakes` its Runs on Atlassian eligibility and breaks the "no data leaves the platform" pitch.
- A static export (`next export`) as a Custom UI resource throws away everything Next.js is for, and its router conflicts with Forge's iframe routing.

Vite builds a plain static React bundle, which is exactly what a Custom UI resource is. See [ADR-0003](adr/0003-ui-kit-and-vite-not-nextjs.md).

## UI Kit vs Custom UI: which surface uses which

| Surface | Module | Rendering | Reason |
|---|---|---|---|
| Issue panel | `jira:issuePanel` | UI Kit | Tiles, lists, tabs, buttons: all available natively |
| Issue context badge | `jira:issueContext` | UI Kit | One line of text |
| Settings | `jira:adminPage` | UI Kit | Forms, sliders, file upload |
| Confluence macro | `macro` | UI Kit | One table |
| Backlog (4 tabs) | `jira:projectPage` | Custom UI | Large sortable table, row drawer, bulk actions, charts, client-side recompute |

If a UI Kit surface needs something UI Kit lacks (for example the sparkline), first try a UI Kit chart component; only move the surface to Custom UI with an ADR.

## Dev tools

- Forge CLI (`forge create`, `deploy`, `install`, `tunnel`, `logs`, `lint`, `eligibility`)
- Forge demo site (`forge site provision`), which includes Rovo
- Teamwork Graph explorer: `https://<site>.atlassian.net/gateway/api/graphql/twg`
- Claude Code with the Forge MCP server and the Atlassian Rovo MCP server

## Version policy

Pin exact versions in `package-lock.json`. Forge packages are bumped deliberately, one at a time, with `forge lint` and the full test suite, because Preview modules change shape between releases.
