# Forge modules and scopes

`stakes` is a Jira-required app with Confluence as an optional product (multi-product compatibility, one app id). `stakes-bridge` is a separate Jira app.

> **Unverified:** properties for Preview/EAP modules (`graph:connector`, `rovo:mcp`, `llm`, `jira:issueContext`, multi-product `compatibility`). Confirm each with the Forge MCP server and `forge lint` when adding it, then update this file.

## Multi-product compatibility (confirmed shape)

`compatibility` sits under `app:` next to `id`. Exactly one product may be required, and only Jira and Confluence are supported.

```yaml
app:
  compatibility:
    jira:
      required: true
    confluence:
      required: false
```

Constraints that follow from it: the app is limited to a single site per installation, storage and data residency follow the required product (Jira), and the required product can only be changed while the app has no installations.

Install order: Jira first, then add Confluence to the same installation.

```bash
forge install -e development --site <site>.atlassian.net --product jira
forge install -e development --site <site>.atlassian.net --product confluence
```

## 1. `stakes` modules

| Key | Type | Render | Resource / handler | Features |
|---|---|---|---|---|
| `stakes-issue-panel` | `jira:issuePanel` | UI Kit | `src/frontend/panel.tsx` | F04–F06, F09, F10, F19 |
| `stakes-issue-context` | `jira:issueContext` | UI Kit | `src/frontend/badge.tsx` | F20 |
| `stakes-backlog` | `jira:projectPage` | Custom UI | `static/backlog/dist` | F07–F09, F15, F17, F21 |
| `stakes-settings` | `jira:adminPage` | UI Kit | `src/frontend/settings.tsx` | F02, F14 |
| `stakes-score-field` | `jira:customField` | — | number, read-only | F16 |
| `stakes-ship-property` | `jira:entityProperty` | — | indexes `status`, `deliveredAt` | F10, F23 |
| `stakes-crm` | `graph:connector` | — | `adapters/connector.ts` | F01 |
| `stakes-analyst` | `rovo:agent` | — | `prompts/agent.md` | F11 |
| `get-issue-stakes` + 6 | `action` | — | `actions/index.*` | F12 |
| `stakes-mcp` | `rovo:mcp` | — | same handlers | F13 |
| `stakes-llm` | `llm` | — | — | F06, F10, F11, F18 |
| `stakes-macro` | `macro` (Confluence) | UI Kit | `src/frontend/macro.tsx` | F24 |
| `on-issue-updated` | `trigger` | — | `triggers/index.onIssueUpdated` | F10 |
| `on-version-released` | `trigger` | — | `triggers/index.onVersionReleased` | F10 |
| `weekly-digest` | `scheduledTrigger` | — | `triggers/index.weeklyDigest` | F18 |
| `nightly-maintenance` | `scheduledTrigger` | — | `triggers/index.nightly` | F14, F19 |

The full manifest sketch is in [PROJECT.md](PROJECT.md#manifest-sketch-stakes).

## 2. `stakes` scopes

| Scope | Why |
|---|---|
| `read:jira-work` | Issues, links, versions, comments, sprints |
| `write:jira-work` | Priority changes, comments, issue properties |
| `read:jira-user` | Owner names and avatars |
| `write:app-data:jira` | Custom field value |
| `read:sprint:jira-software`, `write:sprint:jira-software`, `read:board-scope:jira-software` | Sprint planning |
| `read:servicedesk-request`, `write:servicedesk-request` | Linked JSM requests, replies and notes |
| `read:graph:<object>:<product>` (one per object read) | Teamwork Graph API |
| connector write scope | From the connector docs (spike) |
| `read:confluence-content.summary`, `write:confluence-content`, `read:graph:confluence` | Digest and macro |
| `storage:app` | Forge storage |

**Forbidden in `stakes`:** `permissions.external` (fetch, images, scripts, …), `remotes`, `providers`. `forge eligibility` in CI fails the build if any appear.

Adding a scope changes the installation consent screen, so the installation link must be regenerated and the install guide screenshots updated.

## 3. `stakes-bridge` modules and scopes

| Key | Type |
|---|---|
| `bridge-settings` | `jira:adminPage` (UI Kit) |
| `bridge-crm` | `graph:connector` |
| `crm-sync` | `scheduledTrigger` (`hour`) |
| `deliver` | `scheduledTrigger` (`fiveMinute`) |

Scopes: `read:jira-work`, `write:jira-work` (issue properties), `read:jira-user` (emails for Slack lookup), connector write scope, `storage:app`.

```yaml
permissions:
  external:
    fetch:
      backend:
        - api.hubapi.com
        - slack.com
```

The bridge settings page states that it is not Runs on Atlassian eligible, by design.

## 4. Changing the manifest

1. Edit `manifest.yml`.
2. `forge lint` (and `forge eligibility` for `stakes`).
3. `forge deploy -e development && forge install --upgrade -e development`.
4. If scopes changed: update this file, the install guide, and regenerate the installation link before release.
