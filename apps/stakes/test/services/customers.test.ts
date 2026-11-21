import { describe, expect, it, vi } from 'vitest';
import type { IssueKey } from '@stakes/contracts';
import { makeMirrorStore, makeSnapshotStore } from '../../src/adapters/storage';
import { getCustomerExposure, searchCustomers } from '../../src/services/customers';
import { fakeKvs } from '../fakes/kvs';
import { issueDetails, mirrorCustomer, mirrorDeal } from '../fakes/deps';
import { snapshot } from '../fakes/snapshot';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));

function customerDeps(issues = [issueDetails(), issueDetails({ key: 'PAY-118' })]) {
  const store = fakeKvs();
  const mirror = makeMirrorStore(store.kvs);
  const snapshots = makeSnapshotStore(store.kvs);
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  return {
    mirror,
    snapshots,
    deps: {
      mirror,
      snapshots,
      jira: { issue: vi.fn(async (key: IssueKey) => byKey.get(key) ?? null) },
    },
  };
}

describe('searchCustomers', () => {
  it('matches name prefixes and exact ids from the mirror', async () => {
    const { deps, mirror } = customerDeps();
    await mirror.upsertCustomers([
      mirrorCustomer('CUST-007', 'enterprise', { name: 'Kilima Freight' }),
      mirrorCustomer('CUST-070', 'smb', { name: 'Kilimanjaro Traders' }),
      mirrorCustomer('CUST-099', 'smb', { name: 'Other Freight' }),
    ]);

    expect((await searchCustomers(deps, 'Kilima')).customers).toEqual([
      { id: 'CUST-007', name: 'Kilima Freight', tier: 'enterprise' },
      { id: 'CUST-070', name: 'Kilimanjaro Traders', tier: 'smb' },
    ]);
    expect((await searchCustomers(deps, 'CUST-007')).customers).toEqual([
      { id: 'CUST-007', name: 'Kilima Freight', tier: 'enterprise' },
    ]);
    expect((await searchCustomers(deps, 'Freight')).customers).toEqual([]);
  });
});

describe('getCustomerExposure', () => {
  it('returns Kilima’s open issues and counts a shared deal only once', async () => {
    const issues = [
      issueDetails({ fixVersions: ['2026.12'] }),
      issueDetails({
        key: 'PAY-118',
        summary: 'Webhook retries duplicate payments',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        url: 'https://example.atlassian.net/browse/PAY-118',
      }),
      issueDetails({ key: 'PAY-199', statusCategory: 'done', status: 'Done' }),
    ];
    const { deps, mirror, snapshots } = customerDeps(issues);
    await mirror.upsertCustomers([
      mirrorCustomer('CUST-007', 'enterprise', {
        name: 'Kilima Freight',
        arrUsd: 420000,
        renewalDate: '2027-03-31',
        ownerAccountId: 'owner-1',
      }),
    ]);
    await mirror.upsertDeals([
      mirrorDeal('DEAL-031', 'CUST-007', 220000, 0.6, {
        issueKeys: ['PAY-142', 'PAY-118'],
      }),
      mirrorDeal('DEAL-052', 'CUST-007', 60000, 0.1, {
        closed: true,
        issueKeys: ['PAY-142'],
      }),
      mirrorDeal('DEAL-099', 'CUST-007', 100000, 0.4, {
        issueKeys: ['PAY-199'],
      }),
    ]);
    await mirror.linkCustomers([{ customerId: 'CUST-007', issueKey: 'PAY-142', source: 'demo' }]);
    await snapshots.save(snapshot({ issueKey: 'PAY-142', score: 89 }));
    await snapshots.save(snapshot({ issueKey: 'PAY-118', score: 72 }));

    expect(await getCustomerExposure(deps, 'CUST-007')).toEqual({
      id: 'CUST-007',
      name: 'Kilima Freight',
      tier: 'enterprise',
      arrUsd: 420000,
      renewalDate: '2027-03-31',
      ownerAccountId: 'owner-1',
      dealValueAtRiskUsd: 220000,
      issues: [
        {
          key: 'PAY-142',
          summary: 'CSV export times out above 10k rows',
          status: 'To Do',
          assigneeAccountId: null,
          fixVersions: ['2026.12'],
          score: 89,
          url: 'https://example.atlassian.net/browse/PAY-142',
        },
        {
          key: 'PAY-118',
          summary: 'Webhook retries duplicate payments',
          status: 'In Progress',
          assigneeAccountId: null,
          fixVersions: [],
          score: 72,
          url: 'https://example.atlassian.net/browse/PAY-118',
        },
      ],
    });
  });

  it('includes directly linked open issues even without a deal', async () => {
    const { deps, mirror } = customerDeps();
    await mirror.upsertCustomers([mirrorCustomer('CUST-1', 'smb')]);
    await mirror.linkCustomers([{ customerId: 'CUST-1', issueKey: 'PAY-118', source: 'csv' }]);

    const result = await getCustomerExposure(deps, 'CUST-1');

    expect(result?.dealValueAtRiskUsd).toBe(0);
    expect(result?.issues.map((issue) => [issue.key, issue.score])).toEqual([['PAY-118', null]]);
  });

  it('returns null for an unknown customer', async () => {
    const { deps } = customerDeps();
    expect(await getCustomerExposure(deps, 'CUST-404')).toBeNull();
    expect(deps.jira.issue).not.toHaveBeenCalled();
  });
});
