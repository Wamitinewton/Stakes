import type { CustomerSearch, CustomerView, IssueKey } from '@stakes/contracts';
import type { JiraReader } from '../adapters/jira.js';
import type { MirrorStore, SnapshotStore } from '../adapters/storage.js';

export interface CustomerDeps {
  jira: Pick<JiraReader, 'issue'>;
  mirror: Pick<
    MirrorStore,
    'searchCustomers' | 'customersByIds' | 'dealsForCustomer' | 'directIssueKeysForCustomer'
  >;
  snapshots: Pick<SnapshotStore, 'latestMany'>;
}

export async function searchCustomers(
  deps: Pick<CustomerDeps, 'mirror'>,
  query: string,
): Promise<CustomerSearch> {
  const customers = await deps.mirror.searchCustomers(query);
  return {
    customers: customers.map(({ id, name, tier }) => ({ id, name, tier })),
  };
}

export async function getCustomerExposure(
  deps: CustomerDeps,
  customerId: string,
): Promise<CustomerView | null> {
  const [customer] = await deps.mirror.customersByIds([customerId]);
  if (!customer) return null;

  const [deals, directIssueKeys] = await Promise.all([
    deps.mirror.dealsForCustomer(customerId),
    deps.mirror.directIssueKeysForCustomer(customerId),
  ]);
  const openDeals = [...new Map(deals.map((deal) => [deal.id, deal])).values()].filter(
    (deal) => !deal.closed,
  );
  const issueKeys = [
    ...new Set([...openDeals.flatMap((deal) => deal.issueKeys), ...directIssueKeys]),
  ];
  const [issues, snapshots] = await Promise.all([
    Promise.all(issueKeys.map((issueKey) => deps.jira.issue(issueKey as IssueKey))),
    deps.snapshots.latestMany(issueKeys),
  ]);
  const openIssues = issues.filter(
    (issue): issue is NonNullable<typeof issue> =>
      issue !== null && issue.statusCategory !== 'done',
  );
  const openIssueKeys = new Set(openIssues.map((issue) => issue.key));
  const atRiskDeals = openDeals.filter((deal) =>
    deal.issueKeys.some((issueKey) => openIssueKeys.has(issueKey as IssueKey)),
  );
  const scores = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot.score]));

  return {
    id: customer.id,
    name: customer.name,
    tier: customer.tier,
    arrUsd: customer.arrUsd,
    renewalDate: customer.renewalDate,
    ownerAccountId: customer.ownerAccountId,
    dealValueAtRiskUsd: atRiskDeals.reduce((total, deal) => total + deal.amountUsd, 0),
    issues: openIssues.map((issue) => ({
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      assigneeAccountId: issue.assigneeAccountId,
      fixVersions: issue.fixVersions,
      score: scores.get(issue.key) ?? null,
      url: issue.url,
    })),
  };
}
