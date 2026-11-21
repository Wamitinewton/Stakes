# Demo recording and gallery shot list

Production recording assets for issue #60. **Nothing has been recorded or published yet.** Capture every product shot from the production deployment at the commit tagged `v1.0`; do not substitute design mockups, fixtures, or local-only screens. The architecture diagram may use [`../install-guide/architecture.png`](../install-guide/architecture.png).

## Recording setup

- Complete #54, #55, #56, #57, #58, #59 and #62 before the final capture.
- Reset and seed the fictional Orbit Pay data. Confirm `PAY-142` has the expected score and the four hero issues are available.
- Record at 1920×1080 or higher, 30 fps, with browser zoom and OS scaling at 100%. Hide bookmarks, notifications, account names, real site URLs and unrelated tabs.
- Record the eight segments separately. Use a fresh browser profile and rehearse each click path before recording.
- Narrate after capture using [`captions.srt`](captions.srt) as the source of truth. Keep the final cut at or below 2:55.
- Use no music by default. If music is added later, document its royalty-free licence before export.
- Do not include real customer data, access tokens, private messages or unrestricted `HELP` request details.
- Review the exported captions against the narration, then upload unlisted for Newton's review. Switch to public only after approval.

## Timed segments

| Segment | Time | Screen and actions | Narration |
|---|---|---|---|
| 1. The hidden risk | 0:00–0:20 | Open the ordinary `PAY` backlog with `PAY-142` visible as Low priority. Cut to the Stakes backlog and highlight its US$480K open-deal evidence and Silent fire badge. | This bug is marked Low. It is quietly blocking US$480,000 in open deals. Nobody on the team knows. |
| 2. Evidence becomes a decision | 0:20–0:50 | Show the ranked Stakes backlog. Open the `PAY-142` row drawer, point out the score and suggested priority, then contrast `PAY-150` as a Phantom priority. | Stakes connects Jira to customers, deals, support requests, conversations and goals through the Teamwork Graph. It turns that evidence into a score and ranks the backlog, so this silent fire is impossible to miss. |
| 3. Explain every number | 0:50–1:15 | Open the `PAY-142` issue panel. Show the six signal tiles, summary, history and expanded evidence drawer. Open one source link and return. | Every number has a source. Six tiles show how revenue, customers, support, conversations, goals and urgency contribute. AI explains only the evidence. It never calculates the score, and unsupported numbers are rejected. |
| 4. A person stays in control | 1:15–1:35 | Select `PAY-142` and `PAY-150`, choose Apply suggested priorities, and show the confirmation before approving. Show the resulting audit comment. Open Sprint plan and generate a capacity-bounded proposal; do not apply it unless the reset is repeated. | A person confirms each priority change. Stakes records the evidence and approver, then plans a sprint within the team's capacity. |
| 5. Close the loop | 1:35–2:05 | Move `PAY-142` to Done and release `2026.12`. Reopen the panel, review the Ship notice drafts and recipients, then Send. Show the Jira/JSM result and, only when the bridge is configured, the resulting Slack message. | When the fix ships, Stakes prepares updates for account owners and support agents. Nothing goes out automatically. Review the drafts, select Send, and the optional bridge delivers the internal note to Slack. |
| 6. Ask anywhere | 2:05–2:30 | In Rovo, ask what Kilima Freight is waiting on and show the source-linked answer. Cut to Claude Code calling `stakes_get_issue_stakes` for `PAY-142`; show the structured result and sources without exposing OAuth or account details. | Ask Stakes Analyst what to fix first, what a customer is waiting on, or what a release unblocks. The same read-only tools work through MCP in an external AI assistant, with the user's permissions and source links. |
| 7. Stay in the team's tools | 2:30–2:45 | Show the Confluence weekly digest, the Stakes macro and a successful JQL search using the actual generated score-field alias. | A Confluence digest and macro carry the same context into planning. A read-only Jira field makes the score searchable with JQL. |
| 8. Architecture and close | 2:45–2:55 | Show the exported architecture diagram. Emphasize the no-egress core and separate optional bridge, then end on the Stakes name and tagline. | Connector in. Graph queries out. Deterministic scoring, guarded Forge LLMs, and a no-egress core. Stakes: know what's riding on every work item. |

If a live capability does not behave as described, stop recording and fix or correct the script. Do not conceal a failure with a mock screen or an unsupported narration claim.

## Gallery captures

Export these eight PNG images at 1920×1080 or their native application resolution. Crop only unrelated browser chrome and sensitive account details; keep issue keys, values, sources and confirmation text legible. Store the final files under `docs/submission/gallery/` and use the captions in [`devpost.md`](devpost.md#gallery-captions).

- [ ] **01-backlog-silent-fire.png:** ranked `PAY` backlog with `PAY-142`, its Silent fire badge, revenue and `PAY-150` visible.
- [ ] **02-panel-evidence.png:** `PAY-142` panel with score, six signal tiles and expanded source-linked evidence drawer.
- [ ] **03-confirmed-priority-audit.png:** confirmation listing the exact changes, paired with the resulting Jira audit comment and approver.
- [ ] **04-ship-notice-slack.png:** reviewed ship notice and Send result, paired with the real optional-bridge Slack delivery when configured.
- [ ] **05-rovo-customer-answer.png:** Stakes Analyst answering the Kilima Freight question with open issues and source links.
- [ ] **06-mcp-issue-stakes.png:** external AI client calling `stakes_get_issue_stakes` for `PAY-142`, with structured values and sources visible and credentials hidden.
- [ ] **07-confluence-digest-macro.png:** real Confluence digest and macro showing ranked work, revenue and shipped-fix context.
- [ ] **08-architecture.png:** use the reviewed exported architecture diagram from `docs/install-guide/architecture.png`.

For each image, confirm that it came from the tagged production build, contains only fictional Orbit Pay data, has no real site URL or personal name, and matches its Devpost caption.

## Publication record

| Field | Value |
|---|---|
| Tagged commit | Pending #62 |
| Production deployment | Pending #57 |
| Final video duration | Not recorded |
| Caption review | Not done |
| Music licence | No music planned |
| Unlisted review URL | Not uploaded |
| Public YouTube URL | Not published |
| Gallery files | Not captured |

Issue #60 remains open until the final public URL plays logged out, the duration is under three minutes, captions are available, music rights are documented or no music is used, and the gallery contains the eight real captures above.
