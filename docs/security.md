# Security, privacy and cost controls

Three rules: **every read is permission-aware, every write is human-approved, every LLM credit is capped.**

## 1. Identity and permissions

| Path | Identity | Allowed writes |
|---|---|---|
| Resolvers | Viewing user (`asUser`) | Priority, sprint moves, comments, JSM replies, `stakes.shipNotice`: only after a confirmation dialog |
| Settings resolvers | User, must be Jira admin | Settings, CSV import, seed/remove demo |
| Rovo actions, MCP tools | Calling user | None (read-only) |
| Triggers, scheduled jobs | App (`asApp`) | Storage, pending ship notices, custom field value, digest page. **Never comments or priority changes** |

Every resolver that takes an `issueKey` first fetches the issue as the user; a 404/403 returns `FORBIDDEN` before any other work. This also prevents reading another project's cached snapshot by guessing a key.

Write resolvers require `confirmed: true` and, for priority changes, the `from` value the user saw. If the current value differs, the change is rejected (`STALE_PREVIEW`), so a user never approves a change against out-of-date data.

## 2. Data handling

- `stakes` has **no egress**: no `external.fetch`, no remotes, no providers.
- CRM data lives only in Forge storage and the Teamwork Graph. *Remove demo data* and disconnecting the connector delete it.
- Owner emails from CSV are resolved to account ids and discarded; only account ids are stored.
- Logs contain ids, counts, operation names and durations. Never deal values, customer names, ticket text or prompts.
- `stakes-bridge` sends only the internal ship note and owner emails (for Slack user lookup) to Slack, and only read requests to HubSpot.
- Bridge tokens live in Forge secret storage, tested once on save, never returned to the UI (the UI shows "configured" and the last 4 characters).

## 3. Threat model

| Threat | Vector | Mitigation |
|---|---|---|
| Seeing data you shouldn't | Snapshot computed by user A shown to user B | Snapshots store evidence ids; on read, evidence items the viewer can't access are filtered by checking Jira/JSM access, and the score is labelled "includes items you can't see" |
| Prompt injection | Ticket or comment text instructing the LLM | Text passed as quoted, length-capped DATA; system prompt forbids following it; numeric guard; AI output never triggers actions |
| AI invents numbers | Hallucination | Evidence-only prompt + `core/guard.ts` + template fallback |
| Cross-customer leak in drafts | Customer update mentions another customer | Customer drafts receive only that customer's evidence; guard rejects other customers' names |
| Unapproved writes | Bug or agent calling a write path | Writes only in resolvers with `confirmed: true`; actions/MCP have no write handlers |
| Malicious CSV | Formula injection, oversized input | Strict schema, size cap (1 MB / 5,000 rows), cells starting with `= + - @` rejected in text fields |
| Input injection into JQL/REST paths | Crafted issue/project keys | Keys validated against strict patterns; REST paths built with the `route` tag |
| Bridge token leak | Repo, logs, UI | Secret storage only; secret scanning in CI; never logged |
| Losing Runs on Atlassian | Egress added by mistake | `forge eligibility` in CI |
| Duplicate Slack delivery | Trigger runs twice | `deliveredAt` written after send; JQL excludes delivered; notice id used as idempotency key |

## 4. Cost controls

| Control | Default |
|---|---|
| Daily LLM credit budget | Admin-set; template text when spent |
| LLM cache by evidence hash | Always on |
| Default model | Haiku; Sonnet only for customer drafts |
| Snapshot freshness | 6 hours |
| Backlog recompute batch | 20 issues per invocation |
| Graph queries per panel load | 5 max |
| Bridge CRM sync | Hourly + manual "Sync now" |

## 5. Pre-submission review

- [ ] Forge security-review skill run on both apps; all high findings fixed
- [ ] Forge cost-optimizer skill run on both apps
- [ ] Secret scan of full git history
- [ ] Repo contains no real names, site URLs or tokens
- [ ] `forge eligibility` clean for `stakes`
- [ ] Manual check: a user without access to `HELP` sees no `HELP` request titles in the `PAY-142` panel
