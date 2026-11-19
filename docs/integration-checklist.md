# Integration checklist

Follow this script exactly on the development site. Do not repair code, settings, or demo data between the two final runs. If a step fails, stop, record the failure, fix the cause, and start again from run 1 on a clean site.

## Before run 1

- [ ] Use a fresh browser profile and an organization-admin account on the development site.
- [ ] Have a second account that can open `PAY` but cannot open `HELP`.
- [ ] Have the development installation links for `stakes` and `stakes-bridge`, a HubSpot private-app token, and a Slack bot token available. Never paste credentials into this document or commit them.
- [ ] Replace `<site>`, `<stakes-installation-url>`, `<bridge-installation-url>`, and `<appId>` only in your own working copy or notes.
- [ ] Check out the commit under test and run the local gate:

  ```bash
  npm ci
  npm run typecheck
  npm run lint
  npm run format:check
  npm test
  npm run build
  ```

- [ ] Record the commit SHA, site alias, run number, and start time in the run record at the end.
- [ ] Remove any existing demo data and uninstall both apps before run 1. Run 2 starts by completing the clean-up in section 11 and uninstalling both apps again.

## 1. Install Jira, optional Confluence, and the bridge

- [ ] Open `<stakes-installation-url>`, select `<site>`, and approve the Jira scopes. **Expected:** installation completes without an error.
- [ ] Add Confluence to the same installation and approve its scopes. **Expected:** Stakes settings reports Confluence as connected.
- [ ] Open `<bridge-installation-url>`, select `<site>`, and approve the bridge scopes. **Expected:** the optional bridge installs without an error.
- [ ] In Atlassian administration, connect both the **Stakes CRM** and **Stakes bridge CRM** connectors. **Expected:** both settings pages report their connector as connected.

## 2. Create projects and load demo data

- [ ] Create a Scrum software project with key `PAY` and a service project with key `HELP`. Leave both empty.
- [ ] Open **Apps → Stakes settings → Data**, select `PAY` and `HELP`, and select **Load demo data**. Confirm when asked.
- [ ] Wait for the progress indicator to finish. If a step stops, use the displayed resume action and record the interruption. **Expected:** the final state is Loaded with no raw error or blank panel.
- [ ] If the seeder reports remapped issue keys, write down the real key for `PAY-142` and use it wherever this script names `PAY-142`.
- [ ] Optionally create the Atlassian goal **Reduce enterprise churn**, link it to `PAY-142`, and refresh the panel. **Expected:** score 89 with the goal; score 83 without it.

## 3. Journey A: backlog, confirmed priorities, and sprint plan

- [ ] Open **PAY → Stakes → Backlog**. **Expected:** `PAY-142` is near the top with **Silent fire**; `PAY-150` has **Phantom priority**; scores and revenue have values rather than placeholders.
- [ ] Select `PAY-142` and `PAY-150`, then select **Apply suggested priorities**. **Expected:** the confirmation lists `Low → Highest` and `Highest → Lowest`; nothing changes before confirmation.
- [ ] Confirm the changes. **Expected:** each issue has its new priority and an audit comment naming the approving user, score, and evidence.
- [ ] Open **Sprint plan**, choose the PAY board and the future demo sprint, and generate a plan. **Expected:** chosen issues fit the displayed capacity and unestimated issues are identified.
- [ ] Select **Apply plan**, inspect the issue list, and confirm. **Expected:** only the listed issues move to the selected sprint and each receives an audit entry.
- [ ] Open **Releases**, choose `2026.12`, and toggle `PAY-142` as cut. **Expected:** totals and affected customers update without a page reload.
- [ ] Open **Customers**, search for `Kilima`, and open the customer. **Expected:** Kilima Freight shows its open linked issues, exposure, renewal, and owner.

## 4. Panel, evidence, permissions, and degraded states

- [ ] Open `PAY-142`, `PAY-118`, `PAY-131`, and `PAY-150`. **Expected:** every panel renders a score or an actionable empty state, with no blank area or raw exception.
- [ ] On `PAY-142`, expand every evidence group and open one source link for each displayed signal. **Expected:** each link opens the corresponding Jira request, customer/deal source, conversation, or goal.
- [ ] Check the context badge and score history. **Expected:** the badge agrees with the cached panel score and the history graph renders or explains why no history exists.
- [ ] Sign in as the second account that cannot access `HELP`, then open `PAY-142`. **Expected:** no `HELP` request title, reply text, assignee, or other restricted detail appears; the panel says items are hidden.
- [ ] In **Stakes settings → AI**, set the daily budget to 0 and refresh `PAY-142`. **Expected:** an evidence-based template appears with no AI error; restore the previous budget afterward.
- [ ] Open an issue with no linked evidence. **Expected:** the empty state explains how an admin can import or load data.

## 5. Search the score field

- [ ] Open Jira issue search and run:

  ```jql
  "Stakes Score[Number]" >= 55 ORDER BY "Stakes Score[Number]" DESC
  ```

  **Expected:** `PAY-142` is returned. If Jira exposes a different generated alias, record it and stop for a documentation fix rather than silently substituting it.

## 6. Journey C: Done, release, Send, JSM, and Slack

- [ ] Move `PAY-142` to Done and release version `2026.12`. Reopen the issue panel. **Expected:** a ship-notice banner offers a Review action.
- [ ] Open **Ship notice**, generate one customer reply, and review the internal note and recipients. **Expected:** drafts contain only evidence-backed facts; nothing is posted before Send.
- [ ] Confirm **Send**. **Expected:** one Jira comment mentions the owners, each selected `HELP` request receives the chosen reply, and the result identifies any partial failure.
- [ ] Start a five-minute timer after Send. **Expected:** the internal note appears in the configured Slack channel and mapped owners receive DMs within five minutes. Record the elapsed time.
- [ ] Wait for the next scheduled delivery cycle. **Expected:** no duplicate Slack message or Jira comment appears.

## 7. Journey B: Rovo and MCP

- [ ] In Rovo chat, open **Stakes Analyst** and ask all four questions separately:
  1. `What should we fix first in PAY?`
  2. `What is Kilima Freight waiting on?`
  3. `What revenue does release 2026.12 unblock?`
  4. `Draft an update for customers waiting on PAY-142.`

  **Expected:** answers use the seeded data, include source links, and the draft names no other customer and no deal values.

- [ ] Enable external MCP access for the Stakes installation under Atlassian administration, then configure Claude Code:

  ```bash
  claude mcp add --transport http stakes https://mcp.atlassian.com/forge/<appId>
  ```

- [ ] Complete OAuth from `/mcp`, list the available tools, and call the issue-stakes tool for `PAY-142`. **Expected:** the tool result agrees with the panel and includes sources; no write tool is exposed.

## 8. Confluence digest and macro

- [ ] In **Stakes settings → Confluence**, choose a parent page, enable the digest, save, and select **Run digest now**. **Expected:** one page for PAY is created or updated beneath the chosen parent.
- [ ] Open the digest. **Expected:** it contains top silent fires, recent shipped fixes, revenue unblocked, and phantom priorities, with working Jira links.
- [ ] Insert the Stakes macro three times in a test Confluence page: project `PAY`, fix version `2026.12`, and customer `Kilima Freight`. **Expected:** each mode renders the appropriate highest-stakes issues or an actionable empty state.
- [ ] Remove Confluence from a separate test installation or use an installation without Confluence. **Expected:** Jira scoring continues and settings explains how to connect Confluence; no raw error appears.

## 9. HubSpot edit, Sync now, and score change

- [ ] In **Stakes bridge settings**, save and test the HubSpot token and Slack configuration. **Expected:** only masked secrets are shown after saving.
- [ ] Load the fictional CRM data with `HUBSPOT_TOKEN` set only in the shell environment:

  ```bash
  npm run load:hubspot -w stakes-bridge
  ```

  **Expected:** eight companies and twelve deals are created or updated without duplicate records.

- [ ] Record `PAY-142`'s current score and Kilima Freight's deal amount. Change that amount in HubSpot, select **Sync now**, then refresh the panel. **Expected:** the bridge CRM evidence, score, and graph data reflect the edit; removed deals disappear on the following sync.
- [ ] Repeat **Sync now** without editing HubSpot. **Expected:** no duplicate customers, deals, or associations appear.

## 10. Failure-state sweep

- [ ] Disable the graph reader or remove its scopes in a development deployment, then open the panel and backlog. **Expected:** cached or mirror evidence remains labelled with its source and the degraded source says what to do next.
- [ ] Revoke the second user's access to `PAY` and open a direct Stakes link. **Expected:** a permission message replaces the surface; no cached issue data is displayed.
- [ ] Temporarily enter invalid bridge credentials. **Expected:** save fails without replacing the working secret or showing the submitted token; restore valid credentials afterward.
- [ ] Walk every settings tab as a non-admin. **Expected:** settings render read-only and every mutation control is disabled or explains the admin requirement.

## 11. Remove demo data and verify clean-up

- [ ] Open **Stakes settings → Data**, select **Remove demo data**, and confirm. **Expected:** progress finishes without a blank panel or raw error.
- [ ] Search Jira for `labels = stakes-demo` and search the `HELP` project. **Expected:** no demo issue, request, version, sprint, or audit artifact remains.
- [ ] Search Rovo/Teamwork Graph for the eight fictional customers and twelve deals. **Expected:** no object pushed by either demo connector remains.
- [ ] Open the four former hero issue URLs and the Confluence test page. **Expected:** deleted issues do not render cached snapshots; the macro explains that no matching issues remain.
- [ ] Check that data you created outside the demo remains. **Expected:** only `stakes-demo` and `source = demo` records were removed.
- [ ] Complete every checkbox, then uninstall both apps. Start run 2 from section 1 with no code or data fixes.

## Run records

| Run | Commit SHA | Site alias | Started | Finished | Result | Failure/issue links |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | Not run | — |
| 2 | — | — | — | — | Not run | — |

Issue #56 can close only when both rows record consecutive passes against the same commit, with no manual fixes between them.
