import { describe, expect, it } from 'vitest';
import type { BacklogRow } from '@stakes/contracts';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  NO_FIX_VERSION,
  filterAndSortBacklog,
  filterBacklog,
  sortBacklog,
  type BacklogFilters,
} from '../src/lib/filter';

function row(issueKey: string, overrides: Partial<BacklogRow> = {}): BacklogRow {
  return {
    issueKey,
    issueUrl: `/browse/${issueKey}`,
    summary: `Summary for ${issueKey}`,
    status: 'To Do',
    assignee: 'account-1',
    score: 20,
    currentPriority: 'Medium',
    suggestedPriority: 'High',
    revenueUsd: 100,
    customers: 1,
    customerNames: ['Example customer'],
    tickets: 1,
    badges: [],
    trend: 'flat',
    storyPoints: null,
    fixVersions: ['2026.12'],
    components: ['Reports'],
    ...overrides,
  };
}

const rows = [
  row('PAY-142', {
    summary: 'CSV export times out',
    score: 89,
    revenueUsd: 316_000,
    customers: 3,
    customerNames: ['Kilima Freight', 'Savanna Health', 'Bluepeak Retail'],
    tickets: 7,
    badges: ['silent-fire'],
  }),
  row('PAY-150', {
    summary: 'Refresh settings icon',
    assignee: 'account-2',
    score: 0,
    revenueUsd: 0,
    customers: 0,
    customerNames: [],
    tickets: 0,
    badges: ['phantom'],
    fixVersions: [],
    components: ['Settings'],
  }),
  row('PAY-101', {
    summary: 'Upgrade service runtime',
    score: null,
    revenueUsd: 0,
    customers: 0,
    customerNames: [],
    tickets: 0,
    fixVersions: [],
    components: ['Platform'],
  }),
];

const filters = (overrides: Partial<BacklogFilters>): BacklogFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe('filterBacklog', () => {
  it('searches issue keys and summaries case-insensitively', () => {
    expect(filterBacklog(rows, filters({ query: ' pay-142 ' })).map((r) => r.issueKey)).toEqual([
      'PAY-142',
    ]);
    expect(filterBacklog(rows, filters({ query: 'SETTINGS' })).map((r) => r.issueKey)).toEqual([
      'PAY-150',
    ]);
  });

  it.each([
    [{ version: '2026.12' }, ['PAY-142']],
    [{ version: NO_FIX_VERSION }, ['PAY-150', 'PAY-101']],
    [{ component: 'Settings' }, ['PAY-150']],
    [{ assignee: 'account-2' }, ['PAY-150']],
    [{ customer: 'Savanna Health' }, ['PAY-142']],
    [{ silentFiresOnly: true }, ['PAY-142']],
    [{ phantomsOnly: true }, ['PAY-150']],
  ] as const)('applies %j', (filter, expected) => {
    expect(filterBacklog(rows, filters(filter)).map((r) => r.issueKey)).toEqual(expected);
  });

  it('combines filters and treats the two badge filters as alternatives', () => {
    expect(
      filterBacklog(rows, filters({ silentFiresOnly: true, phantomsOnly: true })).map(
        (r) => r.issueKey,
      ),
    ).toEqual(['PAY-142', 'PAY-150']);
    expect(filterBacklog(rows, filters({ component: 'Reports', assignee: 'account-2' }))).toEqual(
      [],
    );
  });
});

describe('sortBacklog', () => {
  it('sorts numeric columns and keeps unscored issues last', () => {
    expect(
      sortBacklog(rows, { key: 'revenueUsd', direction: 'descending' }).map((r) => r.issueKey),
    ).toEqual(['PAY-142', 'PAY-101', 'PAY-150']);
    expect(
      sortBacklog(rows, { key: 'score', direction: 'ascending' }).map((r) => r.issueKey),
    ).toEqual(['PAY-150', 'PAY-142', 'PAY-101']);
    expect(sortBacklog(rows, DEFAULT_SORT).map((r) => r.issueKey)).toEqual([
      'PAY-142',
      'PAY-150',
      'PAY-101',
    ]);
  });

  it('sorts issue keys numerically in either direction without mutating input', () => {
    const original = [...rows];
    expect(
      sortBacklog(rows, { key: 'issueKey', direction: 'ascending' }).map((r) => r.issueKey),
    ).toEqual(['PAY-101', 'PAY-142', 'PAY-150']);
    expect(
      sortBacklog(rows, { key: 'issueKey', direction: 'descending' }).map((r) => r.issueKey),
    ).toEqual(['PAY-150', 'PAY-142', 'PAY-101']);
    expect(rows).toEqual(original);
  });

  it('filters before sorting and uses issue key to break ties', () => {
    const tied = [row('PAY-10', { score: 50 }), row('PAY-2', { score: 50 })];
    expect(
      filterAndSortBacklog(tied, filters({ query: 'pay' }), {
        key: 'score',
        direction: 'descending',
      }).map((r) => r.issueKey),
    ).toEqual(['PAY-2', 'PAY-10']);
  });
});
