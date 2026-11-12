# ADR-0002: Split egress features into a separate `stakes-bridge` app

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** project owner

## Context

Live CRM sync (F22) and Slack delivery (F23) must call `api.hubapi.com` and `slack.com`. Runs on Atlassian eligibility allows no external domains other than analytics ones with no end-user data, and no remotes or providers. A single `external.fetch` entry would make the whole app ineligible, and "no data leaves the platform" is part of the pitch.

## Options considered

1. **One app with egress.** Simplest; loses the badge and the pitch.
2. **Drop F22 and F23.** Keeps the badge; loses the "owners hear the same day" moment and live data.
3. **Two apps.** `stakes` (no egress) holds F01–F21 and F24; optional `stakes-bridge` holds F22 and F23. They communicate only through the Teamwork Graph and Jira issue entity properties.

## Decision

Option 3.

## Consequences

- `stakes` stays eligible; `forge eligibility` in CI enforces it.
- The apps cannot share storage, so the contract is the `stakes.shipNotice` and `stakesBridge.crm` issue properties, typed in `packages/contracts` and round-trip tested in both apps.
- Slack delivery has up to five minutes of latency (bridge polling via JQL on an indexed property).
- Two registrations, two installation links, two manifests to maintain.
