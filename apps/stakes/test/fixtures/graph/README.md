# Graph fixtures

One happy, empty and error response per query, used by the adapter contract tests.

The current files are shaped from the documented GraphQL connection format, not recorded. Replace each with a response recorded on the dev site, scrubbed of names, account ids, cloud ids and site URLs, and keep the same file names.

| File prefix | Operation |
|---|---|
| `q3` | `stakes_q3_conversations` (persisted) |
| `q4` | `stakes_q4_goals` (curated `jiraWorkItemGoals`) |
| `q5` | `stakes_q5_team` (persisted) |

Q1 lives with the connector spike and Q2 has no graph query: escalations come from linked JSM requests over Jira REST.
