# Testing on an Atlassian site

How to get Stakes running on a real Jira site for the first time, and how to test against that site while we build. The final two-run acceptance script is [integration-checklist.md](integration-checklist.md); this guide gets you to the point where you can run it, and keeps you there.

Use `<site>` for your site name everywhere below. Never commit a real site URL, token or customer name.

## 0. What you need

| Item | Notes |
|---|---|
| Node.js 22.23.4+ | `node -v` |
| Forge CLI | `npm i -g @forge/cli`, then `forge --version` |
| Atlassian account | Organization admin on the dev site. The Teamwork Graph and connector scopes need it. |
| Two Atlassian sites | One for daily development, one kept empty for fresh-install tests. Create both free at <https://go.atlassian.com/cloud-dev> (or `forge site provision` if your CLI offers it). |
| A second Atlassian user | Invited to the dev site, with access to `PAY` but not `HELP`. Used for permission checks. |
| HubSpot developer account, Slack workspace and bot | Bridge app only. Not needed until section 8. |

### Network quirk on some machines

If `forge lint` or `forge deploy` stops with a bare `Error: ApplicationCompileError`, it usually isn't the code. Node gives up connecting to Atlassian's upload storage after 250 ms per address. Give it longer:

```bash
export NODE_OPTIONS="--network-family-autoselection-attempt-timeout=3000"
```

Put that line in your shell profile so every `forge` command gets it.

## 1. One-time setup

### 1.1 Log in to Forge

1. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Run `forge login` and paste your email and the token.
3. Check it worked: `forge whoami`.

### 1.2 Build and check locally

From the repo root:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build          # builds the backlog bundle the manifest points at
```

Don't deploy if any of these fail. A missing `static/backlog/dist` makes the deploy fail.

### 1.3 Register the apps (once per person)

`apps/stakes/manifest.yml` already has a registered app id. Check whether your Atlassian account can deploy it:

```bash
cd apps/stakes
forge lint
```

- **It passes:** you have access. Go to 1.4.
- **"Your app could not be found" or a permission error:** the app belongs to the teammate who registered it. Either ask them to add you as a contributor (developer console → the app → Contributors), or register your own copy with `forge register` on a local branch and don't commit the new id.

The bridge app still has the all-zero placeholder id. Register it once, when you start bridge work, and commit the real id:

```bash
cd apps/stakes-bridge
forge register
```

### 1.4 First deploy and install

```bash
cd apps/stakes
forge lint
forge deploy -e development
forge install -e development --site <site>.atlassian.net --product jira
forge install -e development --site <site>.atlassian.net --product confluence   # optional: digest and macro
```

Approve the scopes when prompted. `forge install list` shows what's installed where.

### 1.5 Connect the CRM connector

1. Go to **admin.atlassian.com → your org → Apps → Connected apps** (in some orgs: **Data connections**).
2. Find **Stakes CRM** and connect it. This is what lets the app push customers and deals into Teamwork Graph.
3. In Jira, open **Apps → Stakes settings**. The connection status should read *connected*.

### 1.6 Create projects and load demo data

1. Create a **Scrum software project** with key `PAY`.
2. Create a **service project** with key `HELP`.
3. Open **Apps → Stakes settings → Data**, select both projects and choose **Load demo data**. Confirm.
4. Wait for **Loaded**. If keys were remapped, note the real key for `PAY-142`.

### 1.7 Smoke test (five minutes)

Do these after the first install and after every deploy that changes behaviour:

- [ ] Open `PAY-142`. The Stakes panel shows a score, badges and evidence, with no blank area.
- [ ] Open **PAY → Stakes → Backlog**. `PAY-142` sits near the top with **Silent fire**.
- [ ] The issue context badge matches the panel score.
- [ ] Rovo chat → **Stakes Analyst** → "What should we fix first in PAY?" returns seeded issues with links.
- [ ] `forge logs -e development --since 15m` shows no errors.

If all five pass, the site is ready for development.

## 2. The daily development loop

There is no local Forge runtime. Logic lives in `src/core` and `src/services`, and is tested without a site. The site is only for checking wiring, permissions and UI.

### 2.1 Order of work for any change

1. **Core function and its unit tests** (`test/core/`). No site.
2. **Service with fake adapters** (`test/services/`): happy, degraded and empty cases. No site.
3. **Adapter with recorded fixtures** (`test/adapters/`). Record the real response once from the site, scrub names and URLs, and commit it as a fixture.
4. **Resolver, action or trigger** that validates input and calls one service.
5. **UI.**
6. **Verify on the site** through the tunnel (2.3).

Keep tests running while you work:

```bash
npm run test:watch -w apps/stakes
```

### 2.2 Decide: tunnel or deploy?

| You changed | Do this |
|---|---|
| Code in `src/` (resolvers, services, UI Kit) | `forge tunnel`. No deploy needed. |
| Backlog Custom UI (`static/backlog`) | Tunnel plus the Vite dev server (2.3). |
| `manifest.yml`: modules, functions, storage entities | `forge deploy -e development`, then tunnel again. |
| `manifest.yml` scopes or egress | `forge deploy -e development` **and** `forge install --upgrade -e development --site <site>.atlassian.net`, then re-approve. |
| Triggers or scheduled jobs | Deploy. The tunnel serves triggers, but scheduled jobs need a real deployment (see 2.5). |
| Prompts in `prompts/` | `npm run prompts -w apps/stakes`, then tunnel. |

### 2.3 Run the tunnel

Terminal 1:

```bash
cd apps/stakes
forge tunnel
```

Terminal 2, only when working on the backlog page:

```bash
npm run dev -w apps/stakes/static/backlog
```

Reload the Jira page. Calls now hit your local code, and `console.log` output appears in terminal 1. Stop the tunnel when you're done; the site goes back to the last deployed version.

Rules that still apply in the tunnel:
- Logs carry ids and counts only. No ticket text, customer names, deal values or prompts.
- Teamwork Graph reads only work as the user, so test them from the panel or backlog, not from a trigger.
- Writes to Jira need `confirmed: true` from the UI. Test them by clicking through the confirmation dialog.

### 2.4 Check what happened

```bash
forge logs -e development --since 30m            # deployed code
forge logs -e development --since 30m --grep <issueKey>
```

The browser dev tools console shows frontend errors from the panel and backlog iframes.

### 2.5 Testing triggers and scheduled jobs

- **Issue updated:** edit a field on a `PAY` issue, then check `forge logs` for the recompute.
- **Version released:** release a test version in `PAY`. A ship-notice banner should appear on its issues.
- **Nightly and weekly digest:** scheduled jobs run only on deployed code, roughly once a day. For a quick check, use **Stakes settings → Confluence → Run digest now**, or wait for the next run and read `forge logs`.

### 2.6 Before opening a pull request

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
cd apps/stakes && forge lint
```

Then on the site:
- [ ] The smoke test (1.7) still passes.
- [ ] The feature works through the tunnel with demo data.
- [ ] Empty, loading, error and low-confidence states render, with no raw exception.
- [ ] If you touched permissions or data shown to users, sign in as the second user and check nothing restricted leaks.
- [ ] Add or update the matching step in [integration-checklist.md](integration-checklist.md).

`forge lint` may list a **major version** approval after a scope change. That isn't an error: admins will be asked to accept the update, and everyone on the team has to run `forge install --upgrade`.

### 2.7 Reviewing a teammate's pull request on the site

```bash
gh pr checkout <n>
npm ci && npm run build
cd apps/stakes && forge deploy -e development   # only if the manifest changed
forge tunnel
```

Walk the PR's checklist steps on your dev site, then stop the tunnel. Both of us deploy to the same `development` environment of the same app, so say in the team chat before you deploy, so we don't overwrite each other mid-test.

## 3. Resetting the dev site

When demo data has drifted:

1. **Stakes settings → Data → Remove demo data**. Confirm and wait.
2. **Load demo data** again.

When the app itself is in a bad state (stale storage, scopes stuck):

```bash
cd apps/stakes
forge uninstall -e development --site <site>.atlassian.net --product jira
forge install -e development --site <site>.atlassian.net --product jira
```

Uninstalling deletes the app's storage on that site. Load demo data again afterwards.

## 4. Fresh-install test (before each milestone)

On the **empty** second site, time this from start to finish. It should take under 10 minutes:

1. Install with the installation link from the developer console (**Distribution → Share**), not the CLI. This is the path judges and customers take.
2. Connect the connector, create `PAY` and `HELP`, load demo data.
3. Run the smoke test (1.7).

Write down anything that confused you, then uninstall.

## 5. The bridge app (HubSpot and Slack)

Only once the bridge is registered (1.3):

```bash
cd apps/stakes-bridge
forge lint
forge deploy -e development
forge install -e development --site <site>.atlassian.net --product jira
```

1. Connect the **Stakes bridge CRM** connector in admin (as in 1.5).
2. In **Stakes bridge settings**, save the HubSpot private-app token and the Slack bot token. Only masked values should show after saving.
3. Load fictional CRM data. Keep the token in your shell only:

   ```bash
   HUBSPOT_TOKEN=... npm run load:hubspot -w stakes-bridge
   ```

4. Change a deal amount in HubSpot, choose **Sync now**, and check that `PAY-142`'s panel and score update.

## 6. Production

The production environment is deployed by hand in submission week only. Before that, every milestone has to pass [integration-checklist.md](integration-checklist.md) twice in a row on the same commit.

```bash
forge deploy -e production
```

If scopes changed, regenerate the installation link in the developer console.

## 7. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `ApplicationCompileError` with no detail | Network timeout, see section 0. Run with `--verbose` to confirm. |
| `must NOT have more than 255 characters` | A Rovo action `description` is too long. Shorten it. |
| "Your app could not be found" | You're not a contributor on that app id, or the manifest still has the placeholder id. See 1.3. |
| Panel shows "Allow access" | Expected the first time a user hits a Teamwork Graph read. Click it and approve. |
| Backlog page is blank after deploy | `npm run build` wasn't run before deploying, so `static/backlog/dist` is stale or missing. |
| Changes not visible | Tunnel not running, or you changed the manifest and didn't deploy. See 2.2. |
| Scope errors after deploy | Run `forge install --upgrade -e development --site <site>.atlassian.net` and re-approve. |
| Graph evidence missing | The connector isn't connected (1.5), or the user hasn't granted access. The panel should label the source as degraded. |
