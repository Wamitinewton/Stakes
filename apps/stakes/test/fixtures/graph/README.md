# Graph fixtures

One happy, empty and error response per query, used by the adapter contract tests.

The current files are shaped from the documented object types, not recorded. Replace each with a response recorded on the dev site, scrubbed of names, account ids, cloud ids and site URLs, and keep the same file names. If the real field names differ, update the selection in `src/adapters/graph.queries.ts` and the parser in `src/adapters/graph.ts` in the same change.

| File prefix | Operation |
|---|---|
| `q1` | `stakes_q1_deals` (persisted) |
| `q3` | `stakes_q3_conversations` (persisted) |
| `q4` | `stakes_q4_goals` (curated `jiraWorkItemGoals`) |
| `q5` | `stakes_q5_team` (persisted) |

Q2 has no graph query: escalations come from linked JSM requests over Jira REST.
