# Devpost submission draft

Draft copy for issue #61. The narrative, built-with tags, technology explanation and graph bonus write-up have been saved in the Devpost draft. Media, final submission and the remaining production fields are still pending.

**Category selected:** Apps for Business Teams (Business Teams)

**Bonus selected:** Best apps with Teamwork Graph integration (Teamwork Graph)

## Verification boundary

The capabilities described below are implemented in the repository and covered by local automated tests. After the hardening changes, 719 Vitest tests passed: 40 shared-contract tests, 615 core-app tests, 22 backlog-UI tests and 42 bridge tests. Fixtures and fakes are not deployed-site validation.

This draft does **not** claim a successful production deployment, fresh installation, live Teamwork Graph read-back, Rovo or MCP conversation, Forge LLM generation, HubSpot sync, Slack delivery, public video, or gallery capture. Those outcomes still need their own live checks.

## Tagline

Know what's riding on every work item.

## Inspiration

Priority meetings too often reward the loudest voice instead of the strongest evidence. A bug can sit at Low priority while customers wait, support requests accumulate and deals approach their close dates. Meanwhile, the people who promised those customers a fix may not hear when it ships.

The evidence already exists, but it is scattered across Jira, the service desk, CRM records, conversations and goals. We built Stakes to bring that context into the decision, make the reasoning visible, and help a person close the loop when the work is done.

## What it does

Stakes turns cross-silo evidence into three connected jobs:

1. **See the stakes.** A Jira issue panel combines customers, open deal value, support pressure, conversation heat, goal alignment and urgency into a 0–100 Stakes Score. Six signal tiles show their raw values and point contributions. An evidence drawer links back to sources, records where each item came from, and exposes degraded sources and limited confidence instead of hiding them.
2. **Decide with evidence.** The project page ranks open work and flags *Silent fires* (high stakes, low priority) and *Phantom priorities* (high priority, no evidence). A person can review and confirm priority changes, with an audit comment recording the evidence and approver. Release and customer views show what a version unblocks and who is waiting; sprint planning proposes a scope within the team's capacity, also subject to confirmation. A read-only Jira number field makes the score available to JQL.
3. **Close the loop.** When an issue reaches Done or a version is released, Stakes prepares internal and customer-facing updates from the stored evidence. Nothing is sent automatically. A reviewer clicks Send to post the Jira and service-desk updates; the optional bridge can then deliver the internal note to Slack.

The same read-only question handlers back the Stakes Analyst Rovo agent and seven MCP tools. Confluence surfaces add a live macro and a weekly digest built from stored snapshots. A demo seeder creates a fictional dataset so an empty site has a concrete story to explore, with a corresponding removal flow.

## How we built it

Stakes is a TypeScript application on Atlassian Forge's Node.js 22 runtime. UI Kit powers the issue panel, context badge, settings and Confluence macro. The backlog is a React Custom UI built with Vite and Atlaskit. Forge KVS and the custom entity store hold settings, snapshots, history, audit records, pending notices and the CRM mirror.

The scoring engine is pure, deterministic TypeScript. It normalises six signals, applies admin-configurable weights, and returns the score and each signal's contribution. AI does not calculate the score. Forge LLMs are used only for summaries and drafts, behind evidence-only prompts, a cache, a daily budget and a numeric post-check that rejects unsupported numbers and falls back to template text.

Both the core app and the optional bridge declare Teamwork Graph connectors for customer organizations and deals. User-facing reads run as the viewing user. Product triggers and scheduled jobs run as the app and use stored snapshots or Jira REST rather than attempting user-only graph reads. Seven read-only action handlers are shared by Rovo and MCP; write actions stay in the UI behind explicit confirmation.

The repository has two apps with different trust boundaries. `stakes` declares no external fetch permissions, remotes or providers. Live HubSpot sync and Slack delivery need external network access, so they live in `stakes-bridge`. Typed Jira issue properties and Teamwork Graph objects form the cross-app contract; the apps do not share storage.

## Challenges

**Making graph reads honest.** Teamwork Graph reads are user-only, and arbitrary Cypher is not available to new apps. Some intended traversals have no curated field, while Q2 has no documented work-item-to-support-escalation relationship at all. We isolated the queries in one adapter, classified partial or failed responses as degraded, and added explicit Jira REST, issue-property and mirror fallbacks. The persisted queries still need registration and live validation.

**Preserving useful CRM detail.** Connector deals do not carry a probability field, and the compact bridge property does not carry every customer attribute. The mirror therefore retains details such as probability, ARR, renewal dates and owner account ids. Evidence source labels make it visible when an answer uses the mirror or bridge rather than a graph traversal.

**Using AI without inventing evidence.** A fluent summary can still introduce an unsupported amount, count or date. The numeric guard checks generated text against the evidence and trusted context, rejects unsupported output, and selects a template instead. Customer drafts also restrict other customers' names and never send themselves.

**Keeping the core on Atlassian.** Live CRM and chat delivery conflict with a no-egress core. Splitting the optional bridge into its own app keeps that boundary explicit, but required typed contracts, idempotent delivery and careful handling of data passed between the apps.

## Accomplishments

- Built an explainable score whose six contributions, evidence sources, confidence and degradation state can be inspected rather than hidden behind an AI-generated number.
- Connected the local product flow from backlog insight to confirmed priority or sprint changes, then to human-reviewed ship notices with an audit trail.
- Implemented one set of read-only handlers for Jira-backed services, Rovo actions and MCP tools, with permission checks and source links.
- Added a fictional demo seed and removal flow, including score history, so the core story does not depend on a judge already having CRM data.
- Kept the no-egress core separate from the optional HubSpot and Slack bridge.
- Reached 692 passing local tests for this draft, including determinism, numeric-guard, graph-response, permission, confirmation, seed/removal, sync and delivery cases. Deployed behavior remains subject to the live checks listed above.

## What we learned

Context is useful only when its provenance survives the journey to the user. A connector push alone does not prove that a relationship can be queried back, and an empty response is not always proof that no evidence exists. Source labels, explicit degraded states and a transparent fallback are part of the product, not just debugging tools.

We also learned to keep deterministic decisions separate from generative language. The score can be tested without a model; AI can explain the result without being trusted to create facts. Finally, platform boundaries are easier to reason about when they are architectural: user-only graph reads, human-approved writes and external egress each have a specific place in the design.

## What's next

First, complete the deployed-site integration runs, fresh-install test and security review, resolve the remaining Teamwork Graph query questions, and verify the Rovo, MCP, Forge LLM and bridge flows before making live claims in the submission.

After the hackathon, we would like to pursue a Marketplace listing, add more CRM sources and chat destinations, and support per-team score profiles and calibration. Those are future directions, not capabilities claimed by this draft.

## Built with

`forge`, `typescript`, `react`, `atlaskit`, `teamwork-graph`, `rovo`, `mcp`, `forge-llms`

## Teamwork Graph bonus write-up

### What both connectors push

The `stakes` connector handles CSV and demo imports. The `stakes-bridge` connector handles live CRM sync. Both push **Customer organization** and **Deal** objects with associations to the Jira work-item keys they depend on. Customer objects carry details such as tier, ARR and renewal date; deal objects carry amount, stage, close date and account name. The current connector mappings do not push owner relationships; owner account ids remain in the mirror or bridge property. Associations are supplied with the object push and replaced as a complete set on re-import; there is no separate link operation.

Writing this context into Teamwork Graph makes CRM objects available to Atlassian's connected context layer. Reading relationships back is what lets Stakes answer questions such as which deals depend on an issue or which goal it serves. Both directions matter: ingestion supplies the context, while traversal turns that context into a decision and a recipient list. The current repository implements both paths, but live connector ingestion, graph traversal and Rovo Search visibility have not been verified for this draft.

### What Stakes queries back

The table records the actual query plan in the current implementation. “Persisted” means code calls `customQuery` with a query key that must be registered in advance; it does **not** mean the query has already been registered or run successfully on a site.

| Query | Intended relationship and use | Kind in current code | Curated/persisted and live status |
|---|---|---|---|
| Q1 `stakes_q1_deals` | Deal → Jira work item; deal/customer ownership; feeds revenue, customer reach, urgency and recipients | Persisted | Candidate only. No curated field covers the work-item-to-deal traversal. Registration, response shape and connector read-back remain unverified. |
| Q2 `stakes_q2_escalations` | Jira work item ↔ support escalation; feeds support pressure | **None — Jira REST fallback** | No documented graph relationship exists. Linked service-desk requests and escalation flags come from Jira REST, not Teamwork Graph. |
| Q3 `stakes_q3_conversations` | External conversation/message mentions Jira work item; feeds conversation heat | Persisted | Candidate only. The relationships are documented, but no curated field exposes this traversal. Registration and live responses remain unverified. |
| Q4 `stakes_q4_goals` | Jira work item contributes to goal; goal state feeds goal alignment | Curated | Candidate uses `jiraWorkItemGoals` with the issue ARI. The field selections and goal-state response still need live validation. |
| Q5 `stakes_q5_team` | Atlassian team assigned to Jira work item; intended for team display and digest context | Persisted | Candidate only. No direct curated field exists. An adapter method exists, but the current collector does not call it and no team line is produced. Registration and live responses remain unverified; looking up an assignee's teams would not prove team ownership of the issue. |

### What actually comes from the mirror or other fallbacks

ADR-0001 is still **Proposed**, with its spike evidence and decision unfilled. It is therefore not evidence that connector deals or customers can be read back through Q1. The collector is implemented to try graph deals first, then the bridge's `stakesBridge.crm` issue property, then the entity-store mirror. Every evidence item retains its source.

For CSV and demo data, the mirror stores customers, deals, work-item links, probabilities, owner account ids, ARR and renewal dates. It also stores demo conversation messages. These details can appear in a score even when no graph traversal supplied them. In particular, connector deals have no probability field, so even a successful Q1 deal response uses the matching mirror probability or a stage default. Bridge customer data is more compact and omits ARR and renewal dates.

Q2's support evidence comes from Jira REST. Demo conversation heat can come from mirror messages while Q3 remains unavailable. If Q4 fails, goal alignment is degraded rather than silently treated as a confirmed graph result. Q5 is not currently consumed by the collector, so it supplies no team line. These fallbacks keep the local product flow usable, but they are not presented as successful Teamwork Graph reads.

## Technology requirement explanation

Stakes is built on **Atlassian Forge**, with Forge functions, hosted UI, storage, event triggers and scheduled jobs forming the application rather than a separately hosted backend. It uses **Teamwork Graph connectors and user-scoped graph queries** to connect work with business context, **Rovo actions and an agent** for conversational access, **Atlassian MCP** to expose the same read-only tools to external assistants, and **Forge LLMs** for guarded summaries and drafts.

The core app declares no external network egress. Optional HubSpot and Slack access is isolated in a second Forge app with an explicit, different data boundary. This is the repository's implementation of the technology requirement; live integration, deployment and final eligibility checks remain outstanding and are not claimed here.

## Gallery captions

Planned captions for the eight images specified in #60. The images have not been captured or uploaded by this change.

1. **Backlog — find the silent fire.** Stakes ranks open work by evidence, surfacing a Low-priority issue with customers, deal value and support pressure behind it.
2. **Issue panel — inspect every number.** Six signal contributions, confidence and a source-linked evidence drawer explain the Stakes Score; source labels distinguish graph, Jira, mirror and bridge evidence.
3. **Confirmed change — preserve the reasoning.** The confirmation lists the exact priority changes before anything is written, and the resulting Jira audit comment records the evidence and approver.
4. **Ship notice — close the loop.** A person reviews the internal and customer updates before Send; the optional bridge delivers the internal note to Slack without making that external delivery part of the core app.
5. **Rovo — ask what is riding on the work.** Stakes Analyst uses the same read-only handlers as the product surfaces to answer backlog, customer, release and drafting questions with sources.
6. **MCP — bring Stakes into an external assistant.** An external AI client calls a Stakes MCP tool and receives structured, permission-aware results with source links; changes still require confirmation in the UI.
7. **Confluence — carry the context into planning.** The weekly digest and macro bring silent fires, shipped fixes, revenue unblocked and ranked work into the team's existing planning space.
8. **Architecture — context in, decisions out.** Two Forge apps separate the no-egress core from optional CRM and chat delivery, with Teamwork Graph, Jira, storage and guarded Forge LLMs behind shared services.

## Final paste and submission checklist

- [x] Paste the narrative fields, built-with tags, technology explanation and bonus write-up into Devpost.
- [x] Select **Apps for Business Teams** and the **Teamwork Graph** bonus in Devpost.
- [ ] Add only verified installation and public video links; upload the final 5–8 gallery images with their captions.
- [x] Save the Devpost draft; complete the final submission separately in Sprint 6.
