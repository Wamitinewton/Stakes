import { describe, expect, it } from 'vitest';
import type { ReleaseView } from '@stakes/contracts';
import { applyCuts } from '../src/lib/release';

const release: ReleaseView = {
  versions: [{ id: '10001', name: '2026.12' }],
  version: { id: '10001', name: '2026.12' },
  issues: [
    {
      issueKey: 'PAY-142',
      summary: 'CSV export',
      score: 89,
      url: 'https://example.atlassian.net/browse/PAY-142',
      dealIds: ['DEAL-031', 'DEAL-034'],
      customerIds: ['CUST-007', 'CUST-009'],
    },
    {
      issueKey: 'PAY-118',
      summary: 'Webhook retries',
      score: 72,
      url: 'https://example.atlassian.net/browse/PAY-118',
      dealIds: ['DEAL-031'],
      customerIds: ['CUST-007'],
    },
  ],
  deals: [
    { id: 'DEAL-031', customerId: 'CUST-007', amountUsd: 220000 },
    { id: 'DEAL-034', customerId: 'CUST-009', amountUsd: 160000 },
  ],
  customers: [
    { id: 'CUST-007', name: 'Kilima Freight' },
    { id: 'CUST-009', name: 'Savanna Health' },
  ],
};

describe('applyCuts', () => {
  it('counts distinct deals and customers with no cuts', () => {
    expect(applyCuts(release, new Set())).toMatchObject({
      revenueUsd: 380000,
      dealCount: 2,
      customers: [{ id: 'CUST-007' }, { id: 'CUST-009' }],
      customersLosingFix: [],
      revenueLostUsd: 0,
    });
  });

  it('keeps a shared deal and its customer covered when only one blocking issue is cut', () => {
    const oneCut = applyCuts(release, new Set(['PAY-142']));

    expect(oneCut.revenueUsd).toBe(220000);
    expect(oneCut.dealCount).toBe(1);
    expect(oneCut.customers.map((customer) => customer.name)).toEqual(['Kilima Freight']);
    expect(oneCut.customersLosingFix.map((customer) => customer.name)).toEqual(['Savanna Health']);
    expect(oneCut.revenueLostUsd).toBe(160000);

    const bothCut = applyCuts(release, new Set(['PAY-142', 'PAY-118']));
    expect(bothCut.revenueUsd).toBe(0);
    expect(bothCut.dealCount).toBe(0);
    expect(bothCut.customersLosingFix.map((customer) => customer.name)).toEqual([
      'Kilima Freight',
      'Savanna Health',
    ]);
  });

  it('does not mutate the release or cut keys', () => {
    const before = structuredClone(release);
    const cutKeys = new Set(['PAY-118']);
    applyCuts(release, cutKeys);
    expect(release).toEqual(before);
    expect(cutKeys).toEqual(new Set(['PAY-118']));
  });
});
