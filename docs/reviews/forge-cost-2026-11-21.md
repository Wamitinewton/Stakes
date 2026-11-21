# Forge cost optimization audit — 21 November 2026

**Scope:** both Forge apps on `main` at `b1a8bef`  
**Method:** Atlassian's official [`forge-cost-optimizer`](https://github.com/atlassian/forge-skills/tree/main/skills/forge-cost-optimizer) workflow and [cost guidance](https://developer.atlassian.com/platform/forge/optimise-forge-costs/). No usage metrics were available, so impacts are qualitative and no savings are claimed.

## Summary

- **Overall opportunity:** Medium for each app, potentially High on busy Jira sites, large projects, large HubSpot datasets, or high notice volume.
- **Core levers:** avoid irrelevant trigger invocations, repeated backlog orchestration, and duplicate Jira reads within a function.
- **Bridge levers:** scheduled-function duration, full CRM resyncs, repeated owner lookups, and unchanged KVS writes.
- The five-minute Slack delivery and hourly CRM sync are product requirements. Increasing those intervals is not a safe quick win.
- This audit records recommendations; it does not weaken authorization, remove required warm-cache permission checks, or implement unmeasured architectural changes during the submission freeze.

## Core opportunities

### 1. High potential — filter irrelevant issue-update events

`apps/stakes/manifest.yml` subscribes to every Jira issue update; `src/services/shipNotice.ts` then exits unless status changed to Done. Add a manifest `filter.expression` based on status-change metadata, validating `event.associatedStatuses != null` in Atlassian's expressions playground. Keep handler checks as defence in depth and use an error policy that logs expression failures during rollout.

### 2. High potential — avoid repeated backlog reads and unchanged writes

`apps/stakes/static/backlog/src/App.tsx` lists, recomputes, updates percentiles, and lists again even with no stale keys. `src/services/rankBacklog.ts` reloads project issues/snapshots for percentiles and writes on every call.

Safe localized options:

- Retain the already listed rows when there are no stale keys; percentile maintenance does not change them.
- Compare calculated percentile content and `scoredCount` with the stored value and skip unchanged writes.
- For stale loads, combine percentile finalization and refreshed listing so issues/snapshots are loaded once.

### 3. Medium-high — reuse issue details within an invocation

Backlog recompute and the issue-stakes action fetch issue details in scoring and again for display after the access check. Pass the trusted adapter result through the invocation rather than repeating the request. Preserve explicit access checks, fail-closed behaviour, and warm-cache linked-request revalidation.

### 4. Medium — remove the duplicate parent-issue read

The initial issue read and linked-request visibility check each fetch the parent. Include `issuelinks` in the initial read and pass expected linked keys into the request-visibility path. Keep visible-issue search, SLA checks, hidden-count comparison, and fail-closed behaviour; skipping those controls would weaken security.

### 5. Medium — aggregate panel resolver work

The panel separately invokes stakes, history, and ship-notice endpoints, while panel construction already checks pending-notice metadata. Return history through an aggregated panel resolver and share one permission-filtered notice result, or lazy-load the full notice only when Review is selected. Forge storage must remain behind resolvers.

### 6. Medium — avoid repeated release/customer work in actions

The release action calls `releaseStakes` before and after resolving a version. Named-customer drafting resolves a snapshot and then `draftCustomer` loads it again. Select the version during the first release pass and pass the validated snapshot into drafting, retaining action-level access checks and customer matching.

### 7. Low-medium — bound fanout and aggregate hot-path logs

Customer issue loading, user display-name lookups, and release snapshot reads use per-item requests. Evaluate bulk endpoints or bounded batches where permission semantics match. Gate per-source graph success logs or aggregate them at batch level while keeping concise warnings and state-change diagnostics.

## Bridge opportunities

### 1. High potential — measure idle scheduled polling

Delivery runs every five minutes and CRM sync hourly, including when unconfigured or no work exists. Measure empty-run ratios before replacing schedules. Event-driven Slack delivery or authenticated HubSpot webhooks must preserve the required latency, retries, idempotency, deletion reconciliation, and full-sync recovery.

### 2. High at CRM scale — full fetch and republish

Each sync accumulates all HubSpot pages, discards unlinked records after retrieval, pushes all mapped objects, and rewrites issue properties with a new `syncedAt`. Evaluate source-side `jira_issue_keys` filtering, company batch reads for mapped deals, and content-based suppression of unchanged writes only with a proven deletion/reconciliation design. `supportsIncrementalSync: false` must not be broken.

### 3. High at notice scale — repeated owner resolution

Owners are deduplicated only within one notice. Repeated owners across notices cause repeated Jira email lookups, Slack email lookups, and DM-channel opens. Add a per-invocation account-ID cache for successful and not-found resolutions, optionally including DM channel IDs. Do not persist owner emails or create an unscoped cross-installation cache; preserve per-owner delivery checkpoints.

### 4. Medium — cheap exits for idle/global failures

Expected unconfigured/disconnected states currently produce repeated failure work and logs. Global Slack outage/rate-limit/channel failures can be followed by attempts for every remaining notice. Treat expected scheduled unconfigured states as idle while preserving manual-sync errors; abort a run on demonstrably global failures and continue isolating notice-specific errors.

### 5. Medium — skip unchanged KVS work

CRM failure status can be rewritten when unchanged; successful sync rewrites previous ID arrays and then performs additional status reads that the scheduled wrapper ignores. Compare before writing and separate scheduled success results from manual UI status enrichment. Keep complete masked status for admin `syncNow`.

### 6. Medium — reduce serial work and allocation churn

Graph/Jira writes are serial and customer/issue mapping repeatedly filters/copies arrays. Pre-group deals by customer and append to existing issue groups as a safe local improvement. Benchmark bounded concurrency for independent requests; do not parallelize unboundedly or disturb delivery checkpoint ordering.

## Needs measurement

- Developer Console invocation counts, p50/p95 duration, GB-seconds, peak memory, KVS/entity read-write bytes, and log bytes by function.
- Backlog stale/no-stale ratio, repeated-owner ratio, idle delivery ratio, HubSpot page counts, total versus Jira-linked CRM records, and unchanged-sync ratio.
- No functions declare custom `memoryMiB` or `timeoutSeconds`. Profile before tuning; shared resolvers mix lightweight and heavy routes, while CRM sync must accommodate full payloads.
- Benchmark concurrency against rate limits and partial side effects. Snapshot slimming or UI pagination should follow measured payload/read volumes, not guesses.

## Existing efficient patterns to preserve

- Frontend effects are dependency-bound; no render-body invocations or timer polling loops were found. Product context already comes from Forge context APIs.
- Major Jira/Graph/entity reads use explicit fields, indexes, source-side filters, page sizes, and cursors. Graph object pushes/deletes are chunked.
- Existing snapshot/LLM caching and required permission revalidation must remain intact.
- Logs generally contain identifiers, counts, and outcomes rather than payloads.
- Core has no Forge SQL, remotes, or external egress. Bridge uses no LLM/Forge SQL. Forge Remote is not justified without profiling and would add operational and eligibility trade-offs.

## Recommended order

1. Establish the usage baseline.
2. Validate the core issue-event filter and localized backlog/action deduplication.
3. Apply bridge per-invocation owner caching, unchanged-write suppression, and linear grouping with focused tests.
4. Measure before considering event-driven schedules, concurrency, memory/timeout tuning, or incremental CRM retrieval.
