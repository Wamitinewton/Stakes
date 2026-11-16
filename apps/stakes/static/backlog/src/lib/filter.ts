import type { BacklogRow } from '@stakes/contracts';

export const NO_FIX_VERSION = 'no-fix-version';

export interface BacklogFilters {
  query: string;
  version: string;
  component: string;
  assignee: string;
  customer: string;
  silentFiresOnly: boolean;
  phantomsOnly: boolean;
}

export const EMPTY_FILTERS: BacklogFilters = {
  query: '',
  version: '',
  component: '',
  assignee: '',
  customer: '',
  silentFiresOnly: false,
  phantomsOnly: false,
};

export type BacklogSortKey = 'issueKey' | 'score' | 'revenueUsd' | 'customers' | 'tickets';
export type SortDirection = 'ascending' | 'descending';
export interface BacklogSort {
  key: BacklogSortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: BacklogSort = { key: 'score', direction: 'descending' };

export function filterBacklog(rows: BacklogRow[], filters: BacklogFilters): BacklogRow[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      query &&
      !row.issueKey.toLocaleLowerCase().includes(query) &&
      !row.summary.toLocaleLowerCase().includes(query)
    ) {
      return false;
    }
    if (filters.version === NO_FIX_VERSION && row.fixVersions.length > 0) return false;
    if (
      filters.version &&
      filters.version !== NO_FIX_VERSION &&
      !row.fixVersions.includes(filters.version)
    ) {
      return false;
    }
    if (filters.component && !row.components.includes(filters.component)) return false;
    if (filters.assignee && row.assignee !== filters.assignee) return false;
    if (filters.customer && !row.customerNames.includes(filters.customer)) return false;
    const fire = row.badges.includes('silent-fire');
    const phantom = row.badges.includes('phantom');
    if (filters.silentFiresOnly && filters.phantomsOnly) return fire || phantom;
    if (filters.silentFiresOnly && !fire) return false;
    if (filters.phantomsOnly && !phantom) return false;
    return true;
  });
}

const byIssueKey = (a: BacklogRow, b: BacklogRow) =>
  a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true });

export function sortBacklog(rows: BacklogRow[], sort: BacklogSort): BacklogRow[] {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'score') {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
    }
    const difference =
      sort.key === 'issueKey'
        ? byIssueKey(a, b) * direction
        : ((a[sort.key] ?? -1) - (b[sort.key] ?? -1)) * direction;
    return difference || byIssueKey(a, b);
  });
}

export function filterAndSortBacklog(
  rows: BacklogRow[],
  filters: BacklogFilters,
  sort: BacklogSort,
): BacklogRow[] {
  return sortBacklog(filterBacklog(rows, filters), sort);
}
