# Stakes

**Know what's riding on every work item.**

Stakes is a Forge app for Jira that shows the customers, deal value, support pressure, conversations and goals linked to every work item, ranks the backlog by that evidence, and drafts updates for sales and support when the work ships. Built for Codegeist 2026.

> Status: Phase 0 (foundation and spikes). Nothing is installable yet. The judge install guide replaces this section before submission.

## What it does

1. **See the stakes.** An issue panel with a 0–100 Stakes Score, six signal tiles and an evidence drawer where every number links to its source.
2. **Decide.** A backlog page ranked by score that flags *silent fires* (high stakes, low priority) and *phantom priorities* (high priority, no evidence), and applies suggested priorities after confirmation, with an audit comment.
3. **Close the loop.** When work ships, Stakes finds the account owners and support agents through the Teamwork Graph and drafts the updates for a person to send.

The same answers are available in Rovo chat (Stakes Analyst agent) and from any MCP client.

## Two apps

| App | Egress | Purpose |
|---|---|---|
| [`apps/stakes`](apps/stakes) | None (Runs on Atlassian eligible) | Everything except live CRM sync and Slack delivery |
| [`apps/stakes-bridge`](apps/stakes-bridge) | `api.hubapi.com`, `slack.com` | Optional: hourly HubSpot sync and Slack delivery of ship notices |

They share no storage. Their only contract is two Jira issue entity properties, typed once in [`packages/contracts`](packages/contracts).

## Repository layout

```
packages/contracts/   shared issue-property keys and schemas
apps/stakes/          core Forge app
apps/stakes-bridge/   optional Forge app with egress
docs/                 product brief, architecture, ADRs
design/               UI mocks
```

## Development

Requires Node.js 22 and npm 10+.

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

Forge setup, the daily loop and conventions are in [docs/development.md](docs/development.md). Start with [docs/README.md](docs/README.md) for the full technical docs.

## Score formula

The score is deterministic arithmetic over evidence; AI only writes the words around it. See [docs/scoring.md](docs/scoring.md).

## Data handling

The core app declares no egress and runs AI on Forge LLMs. CRM data lives in Forge storage and the Teamwork Graph. See [docs/security.md](docs/security.md).

## Licence

[MIT](LICENSE)
