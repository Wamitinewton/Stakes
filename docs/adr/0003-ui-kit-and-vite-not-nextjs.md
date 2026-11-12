# ADR-0003: UI Kit for small surfaces, React + Vite for the backlog, no Next.js

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** project owner

## Context

Stakes has five UI surfaces: issue panel, issue context badge, admin settings, Confluence macro, and a four-tab backlog page. Forge offers UI Kit (native components rendered by Atlassian) and Custom UI (a static bundle in an iframe). The question came up whether to use Next.js.

## Options considered

1. **Next.js as a server.** Needs hosting outside Forge (a `remote`), which breaks Runs on Atlassian eligibility and the no-egress pitch.
2. **Next.js static export as Custom UI.** No SSR or API routes left; its router conflicts with Forge iframe routing; heavier build for no gain.
3. **UI Kit everywhere.** Fastest and most native, but the backlog needs a large sortable table, row drawer, bulk actions and charts.
4. **UI Kit for small surfaces, Custom UI (React + Vite + Atlaskit) for the backlog.**

## Decision

Option 4.

## Consequences

- Panel, badge, settings and macro use `@forge/react` with no bundler.
- The backlog is a Vite app in `apps/stakes/static/backlog/`, built to `dist/` and declared as the `backlog-ui` resource; it uses Atlaskit and design tokens for native look and dark mode, and Recharts for charts.
- Both call the backend only through resolvers via `@forge/bridge`.
- Moving any other surface to Custom UI needs a new ADR.
