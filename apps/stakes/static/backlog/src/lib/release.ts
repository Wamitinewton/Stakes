import type { IssueKey, ReleaseCustomer, ReleaseIssue, ReleaseView } from '@stakes/contracts';

export interface ReleaseCutView {
  keptIssues: ReleaseIssue[];
  revenueUsd: number;
  dealCount: number;
  customers: ReleaseCustomer[];
  customersLosingFix: ReleaseCustomer[];
  revenueLostUsd: number;
}

export function applyCuts(release: ReleaseView, cutKeys: ReadonlySet<IssueKey>): ReleaseCutView {
  const keptIssues = release.issues.filter((issue) => !cutKeys.has(issue.issueKey));
  const keptDealIds = new Set(keptIssues.flatMap((issue) => issue.dealIds));
  const keptCustomerIds = new Set(keptIssues.flatMap((issue) => issue.customerIds));
  const revenueUsd = release.deals
    .filter((deal) => keptDealIds.has(deal.id))
    .reduce((total, deal) => total + deal.amountUsd, 0);
  const fullRevenueUsd = release.deals.reduce((total, deal) => total + deal.amountUsd, 0);
  return {
    keptIssues,
    revenueUsd,
    dealCount: keptDealIds.size,
    customers: release.customers.filter((customer) => keptCustomerIds.has(customer.id)),
    customersLosingFix: release.customers.filter((customer) => !keptCustomerIds.has(customer.id)),
    revenueLostUsd: fullRevenueUsd - revenueUsd,
  };
}
