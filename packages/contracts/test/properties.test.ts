import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CRM_MAX_DEALS,
  BridgeCrmProperty,
  ISSUE_PROPERTY_MAX_BYTES,
  ShipNoticeProperty,
  bridgeCrmByteLength,
  fitBridgeCrm,
  type BridgeDeal,
} from '../src/index.js';

const deal = (i: number, overrides: Partial<BridgeDeal> = {}): BridgeDeal => ({
  id: `DEAL-${i}`,
  name: `Deal number ${i}`,
  amountUsd: i * 1000,
  stage: 'Negotiation',
  probability: 0.6,
  closeDate: '2026-12-15',
  ownerAccountId: 'acc-1',
  customer: { id: `CUST-${i}`, name: `Customer ${i}`, tier: 'enterprise' },
  ...overrides,
});

describe('ShipNoticeProperty', () => {
  const valid = {
    status: 'sent',
    internalNote: 'Shipped in 2026.12',
    ownerAccountIds: ['acc-1'],
    sentAt: '2026-11-20T08:00:00Z',
  };

  it('accepts a sent notice with and without a delivery time', () => {
    expect(ShipNoticeProperty.safeParse(valid).success).toBe(true);
    expect(
      ShipNoticeProperty.safeParse({ ...valid, deliveredAt: '2026-11-20T08:05:00Z' }).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown status', { status: 'pending' }],
    ['a note over 2000 characters', { internalNote: 'x'.repeat(2001) }],
    ['a bad timestamp', { sentAt: '20 Nov 2026' }],
  ])('rejects %s', (_label, change) => {
    expect(ShipNoticeProperty.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe('BridgeCrmProperty', () => {
  const valid = { deals: [deal(1)], syncedAt: '2026-11-20T08:00:00Z' };

  it('accepts a valid value, including a deal with no close date or owner', () => {
    expect(BridgeCrmProperty.safeParse(valid).success).toBe(true);
    expect(
      BridgeCrmProperty.safeParse({
        ...valid,
        deals: [deal(2, { closeDate: null, ownerAccountId: null })],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['probability above 1', { probability: 1.2 }],
    ['probability below 0', { probability: -0.1 }],
    ['a negative amount', { amountUsd: -5 }],
    ['a bad date', { closeDate: '2026-13-40' }],
    ['an unknown tier', { customer: { id: 'C', name: 'C', tier: 'whale' } }],
  ])('rejects %s', (_label, change) => {
    expect(
      BridgeCrmProperty.safeParse({ ...valid, deals: [deal(1, change as Partial<BridgeDeal>)] })
        .success,
    ).toBe(false);
  });
});

describe('fitBridgeCrm', () => {
  it('keeps the 50 largest deals of 200 and stays under the property limit', () => {
    const input = {
      deals: Array.from({ length: 200 }, (_, i) => deal(i + 1)),
      syncedAt: '2026-11-20T08:00:00Z',
    };
    const fitted = fitBridgeCrm(input);
    expect(fitted.deals).toHaveLength(BRIDGE_CRM_MAX_DEALS);
    expect(fitted.deals[0]!.id).toBe('DEAL-200');
    expect(fitted.deals.at(-1)!.id).toBe('DEAL-151');
    expect(bridgeCrmByteLength(fitted)).toBeLessThan(ISSUE_PROPERTY_MAX_BYTES);
    expect(BridgeCrmProperty.safeParse(fitted).success).toBe(true);
  });

  it('drops more deals when 50 long-named deals would still be too large', () => {
    const input = {
      deals: Array.from({ length: 50 }, (_, i) => deal(i + 1, { name: 'é'.repeat(600) })),
      syncedAt: '2026-11-20T08:00:00Z',
    };
    const fitted = fitBridgeCrm(input);
    expect(fitted.deals.length).toBeLessThan(50);
    expect(bridgeCrmByteLength(fitted)).toBeLessThan(ISSUE_PROPERTY_MAX_BYTES);
  });

  it('leaves a small value unchanged apart from ordering', () => {
    const fitted = fitBridgeCrm({ deals: [deal(1), deal(3)], syncedAt: '2026-11-20T08:00:00Z' });
    expect(fitted.deals.map((d) => d.id)).toEqual(['DEAL-3', 'DEAL-1']);
  });
});
