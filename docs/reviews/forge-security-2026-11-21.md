# Forge security review — 21 November 2026

**Scope:** `apps/stakes`, `apps/stakes-bridge`, and shared contracts  
**Source baseline:** `b1a8bef` plus the dependency resolutions in PR #117  
**Method:** Atlassian's official [`forge-security-review`](https://github.com/atlassian/forge-skills/tree/main/skills/forge-security-review) workflow: manifest-first execution mapping, FSRT and OpenGrep, rule-routed manual review, dependency audit, and full-history secret scanning.

## Verdict

**No confirmed exploitable finding remains open in the reviewed source. No open high or critical dependency advisory remains after PR #117.** This is not production certification: authenticated Forge eligibility and the deployed restricted-permission checks are still pending.

Two high-impact source findings were confirmed and fixed before this final review:

- Warm snapshots could return another viewer's linked `HELP` evidence and generated summary. PR #116 now revalidates linked-issue visibility, fails closed on hidden/omitted links or permission errors, prevents viewer-filtered snapshots/history/field values from being persisted, and redacts ship-notice drafts when request access is incomplete.
- Generated-text cache keys omitted issue and prompt context. PR #116 now hashes canonical evidence and sorted context for summaries, ship notices, customer drafts, and digests without placing raw issue summaries or customer names in keys.

The official manual review of the fixed source confirmed no remaining cross-issue/cache disclosure path. No CVSS vector or exploit PoC is assigned to non-exploitable hardening observations below.

## Execution map and controls

### Core app

- UI Kit and Custom UI surfaces call the shared resolver. Resolver payloads are schema-validated and identity comes from Forge context.
- Seven Rovo/MCP action handlers share the same read-only services. Jira and Teamwork Graph reads run as the calling user; issue-level actions check access before service work.
- There are no web triggers, anonymous modules, unlicensed-access declarations, external fetch permissions, remotes, providers, or CSP relaxations.
- User-authored Jira changes require confirmation and run as the approving user. The app-owned read-only score field is the documented system-write exception.
- Storage is installation-scoped by Forge. No private cross-tenant API, SQL, generic storage-key proxy, or module-level evidence cache was found.

### Bridge app

- All four resolvers check Jira global-admin permission before status, secrets, configuration, or manual sync work. Failed or malformed permission responses fail closed.
- HubSpot and Slack tokens use Forge secret storage and only masked status is returned. Runtime egress is fixed to `api.hubapi.com` and `slack.com`.
- Jira routes use Forge `route`; issue keys and cross-app properties are schema-validated. JQL is constant and external query values use `URLSearchParams`.
- No raw HTML sink, dynamic code execution, payload-controlled host, hard-coded production credential, or sensitive response-body logging was found.

All declared scopes in both manifests have corresponding source paths. Effective deployed scopes and installation configuration still require runtime verification.

## Deterministic finding triage

Core OpenGrep produced three warnings; bridge produced none. None established a vulnerability:

1. **Numeric LLM token logging — false positive.** `src/adapters/llm.ts` and `src/resolvers/index.ts` log model identifiers and numeric input/output token counts, not credentials, prompts, completions, identities, or payload objects.
2. **Digest HTML construction — no reachable XSS.** Issue keys, priorities, versions, and generated introduction text are XML-escaped in `src/services/digest.ts`. Scores/revenue/counts are numeric; reachable sent timestamps are application-generated ISO strings. The result is sent as Confluence storage format, not injected into a browser DOM sink.

FSRT reported zero findings in both apps, but core completed with warnings. Its secret/auth-header checkers could not analyse the seven exported Rovo action handlers and reported resolver/Jira-type-resolution gaps. Zero FSRT findings therefore do not prove those handlers safe; they were manually reviewed instead.

## Dependency and secret review

- Initial `npm audit`: **8 high, 13 moderate, 0 critical**. The high advisory was GHSA-c8x8-7fp4-3x9w through transitive `prosemirror-view` versions before 1.42.3.
- PR #117 pins `prosemirror-view` to 1.42.3 across all consumers and updates TypeScript ESLint/minimatch. Final audit: **0 high, 0 critical, 9 moderate**.
- The remaining moderate advisories are the Forge manifest `glob`/`minimatch` chain. npm offers no compatible fix for `@forge/api`, `@forge/llm`, `@forge/manifest`, `glob`, or `minimatch`; proposed fixes for other Forge packages are major downgrades and were not forced. These remain release follow-ups, not hidden clean results.
- Gitleaks scanned **91 commits across all refs** on 2026-11-21 and found no leaks.
- Repository sweeps found fictional Orbit Pay names, `example.atlassian.net` URLs, and `example.com` email fixtures only. Token-prefix searches returned no matches. Team member names in project ownership documentation are not customer data.

## Hardening and policy follow-ups

### Core

- **Soft LLM budget and diagnostic exception:** normal usage accounting is check-then-call and non-atomic; concurrent calls can cross the cap or lose increments. Admin-only `llmCheck` bypasses the normal enable/budget/cache/usage path. If the budget is intended as a hard financial quota, this design does not meet it.
- **Upstream connector rejection text:** `src/adapters/connector.ts` can log upstream error strings. No sensitive real response was evidenced, but live canary responses should confirm they cannot echo CRM content.
- **Prompt trust boundary:** issue summaries, context, and evidence titles/details appear outside the explicitly untrusted `DATA` block. Numeric/citation guards and text-only sinks remain in place, but adversarial live prompts should test unwanted non-numeric wording.
- **Warm-instance site URL:** `src/actions/index.ts` caches the first `serverInfo.baseUrl` without a tenant key. Wrong-site links are possible if Forge reuses that instance across installations; cross-tenant disclosure was not established.
- **Rovo cloud ID and shared-state policy:** payload-preferred `cloudId`, viewer dismissal of pending notices, and shared percentile updates need deployment/policy validation. No privilege escalation was demonstrated.

### Bridge

- **At-least-once Slack delivery:** a successful Slack side effect followed by checkpoint failure, or concurrent schedules, can repeat a message. Existing checkpoints prevent ordinary sequential retries but do not prove exactly-once delivery.
- **Disconnect lifecycle:** deleting the connector connection removes Graph objects through the platform but leaves bridge-owned Jira CRM properties and previous-sync metadata. Define and test the intended retention/deletion policy.
- **Unbounded work:** HubSpot/Jira pagination and downstream processing have page-size limits but no total page/work bound, repeated-cursor guard, or persistent continuation. Production-scale timeout and resume behaviour needs measurement.
- **Workspace-wide Graph visibility:** `replicatesPermissions: false` and workspace principals intentionally make ingested CRM objects visible across the Atlassian workspace. Confirm this matches customer confidentiality expectations.
- **Actor auditing:** sensitive configuration changes have authorization but no application-level administrator/timestamp/outcome audit record. Inspect available platform audit logs before adding another store.

## Coverage and evidence gaps

| Tool/check | Result | Limitation |
|---|---|---|
| FSRT v0.1.1 | Core completed with warnings, 0 findings; bridge completed, 0 findings | Core action checkers failed as described above; `scanned:[""]` gives no per-file coverage proof |
| OpenGrep 1.16.2 | Core 3 warnings triaged; bridge 0 findings; 0 file errors | Ignore patterns excluded generated/ignored files; deterministic rules are not a complete manual review |
| npm audit | 0 high/critical and 9 moderate after PR #117 | Moderate Forge dependency chain remains |
| Gitleaks | 91 commits, no leaks | Pattern-based secret scanning is not proof that no secret ever existed |
| Snyk | Not run | Additional dependency coverage unavailable |
| Workspace verification | Typecheck, ESLint, Prettier, build, and 732 tests passed | Fixtures/fakes are not deployed-site validation |

Relevant global, authz, entry-point, injection, tenant-isolation, secrets/storage, manifest, Rovo, and auditing rules were loaded according to app signals. Egress rules were not separately loaded for the no-egress core; Rovo rules were not applicable to the bridge; misc dependency rules were covered separately by npm audit. Untriggered deep SQL/RCE/CSP/web-trigger rules were not loaded.

## Live-only checks before release

1. Run authenticated Forge lint and `forge eligibility` for the registered production apps.
2. Create a warm snapshot as a `HELP`-visible user, then open `PAY-142` as a user without `HELP` access. Check panel, backlog, macro, badge, trends, generated text, and ship notices for restricted titles or cached summaries.
3. Exercise cold restricted-first reads, legitimate link additions/removals, failed permission reads, and cross-installation warm starts.
4. Test adversarial prompts, concurrent LLM usage, real Graph rejection logs, and Confluence rendering.
5. On the bridge, test concurrent/duplicate schedules, post-success checkpoint failures, large datasets/timeouts, connector disconnect cleanup, workspace-wide Graph visibility, and actual token scopes/recipient mappings.
