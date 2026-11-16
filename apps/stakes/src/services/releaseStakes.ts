import type {
  ProjectKey,
  ReleaseCustomer,
  ReleaseDeal,
  ReleaseIssue,
  ReleaseView,
  Snapshot,
} from '@stakes/contracts';
import type { IssueDetails, JiraReader } from '../adapters/jira.js';
import type { MirrorStore, SnapshotStore } from '../adapters/storage.js';

export interface ReleaseDeps {
  jira: Pick<JiraReader, 'openIssues' | 'unreleasedVersions'>;
  snapshots: Pick<SnapshotStore, 'latestMany'>;
  mirror: Pick<MirrorStore, 'customersByIds'>;
}

function toReleaseIssue(issue: IssueDetails, snapshot: Snapshot | null): ReleaseIssue {
  const dealIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const item of snapshot?.evidence ?? []) {
    if (item.facts.kind === 'deal' && !item.facts.closed) {
      dealIds.add(item.facts.dealId);
      if (item.facts.customerId) customerIds.add(item.facts.customerId);
    }
    if (item.facts.kind === 'customer') customerIds.add(item.facts.customerId);
  }
  return {
    issueKey: issue.key,
    summary: issue.summary,
    score: snapshot?.score ?? null,
    url: issue.url,
    dealIds: [...dealIds],
    customerIds: [...customerIds],
  };
}

export async function releaseStakes(
  deps: ReleaseDeps,
  projectKey: ProjectKey,
  versionId?: string,
): Promise<ReleaseView | null> {
  const [versions, openIssues] = await Promise.all([
    deps.jira.unreleasedVersions(projectKey),
    deps.jira.openIssues(projectKey),
  ]);
  const version = versionId
    ? (versions.find((candidate) => candidate.id === versionId) ?? null)
    : (versions[0] ?? null);
  if (!version) {
    return versionId ? null : { versions, version: null, issues: [], deals: [], customers: [] };
  }

  const versionIssues = openIssues.filter((issue) => issue.fixVersions.includes(version.name));
  const snapshots = await deps.snapshots.latestMany(versionIssues.map((issue) => issue.key));
  const byIssue = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot]));
  const issues = versionIssues
    .map((issue) => toReleaseIssue(issue, byIssue.get(issue.key) ?? null))
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }),
    );

  const deals = new Map<string, ReleaseDeal>();
  const customerNames = new Map<string, string>();
  for (const issue of issues) {
    const snapshot = byIssue.get(issue.issueKey);
    for (const item of snapshot?.evidence ?? []) {
      if (item.facts.kind === 'deal' && !item.facts.closed && !deals.has(item.facts.dealId)) {
        deals.set(item.facts.dealId, {
          id: item.facts.dealId,
          customerId: item.facts.customerId,
          amountUsd: item.facts.amountUsd,
        });
      }
      if (item.facts.kind === 'customer') customerNames.set(item.facts.customerId, item.facts.name);
    }
  }

  const customerIds = new Set(issues.flatMap((issue) => issue.customerIds));
  const mirrorCustomers = await deps.mirror.customersByIds([...customerIds]);
  for (const customer of mirrorCustomers) customerNames.set(customer.id, customer.name);
  const customers: ReleaseCustomer[] = [...customerIds]
    .map((id) => ({ id, name: customerNames.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    versions,
    version,
    issues,
    deals: [...deals.values()].sort((a, b) => a.id.localeCompare(b.id)),
    customers,
  };
}
