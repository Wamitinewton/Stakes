# Stakes: project memory

Forge app for Jira (plus an optional bridge app) that scores every work item by the evidence riding on it. Product brief: `docs/PROJECT.md`. Engineering docs: `docs/README.md`.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` (also builds `packages/contracts`) |
| Type-check | `npm run typecheck` |
| Lint (includes layer rules) | `npm run lint` |
| Format check | `npm run format:check` |
| Tests | `npm test`, or `npm test -w apps/stakes` |
| Coverage | `npm run test:coverage` (fails below 90% lines on `apps/stakes/src/core`) |

## Layer rules (enforced by ESLint, tested in `apps/stakes/test/architecture`)

- `src/core/`: pure TypeScript. No `@forge/*`, no adapters, no I/O.
- `src/adapters/`: the only place importing `@forge/api`, `@forge/kvs`, `@forge/llm`, `@forge/teamwork-graph`.
- `src/services/`: orchestration; take adapters as parameters so tests pass fakes.
- `src/resolvers|actions|triggers/`: validate, call one service, shape the response. May import `@forge/resolver` and `@forge/events` only.
- `src/frontend/` and `static/backlog/`: call resolvers through `@forge/bridge`; never import from `src/`.

## Hard rules

- `apps/stakes` declares no `permissions.external`, `remotes` or `providers`. CI fails if it does.
- Teamwork Graph reads only `asUser`, never from triggers or scheduled jobs.
- Every write to Jira happens in a resolver, after `confirmed: true`, as the approving user.
- AI writes words, never numbers; the numeric guard rejects any number not in the evidence.
- Logs carry ids and counts only. No deal values, customer names, ticket text or prompts.
- No credentials, real customer names or site URLs in the repo (use `<site>`).

## Decisions

- ADR-0002: two-app split (accepted).
- ADR-0003: UI Kit for small surfaces, React + Vite for the backlog (accepted).
- ADR-0001: CRM read path (mirror primary or fallback). **Pending the connector read-back spike.**

## Conventions

- Branches `feat|fix|chore/<slug>`, started with `gh issue develop <n> --checkout --name <branch>`.
- Conventional commits (`feat(score): add urgency decay`). Closing keywords in PR descriptions, one per line.
- Code comments explain why, in their own words; never reference docs, sprints or tickets.
