import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CRM_PROPERTY_KEY,
  BridgeCrmProperty,
  SHIP_NOTICE_PROPERTY_KEY,
  ShipNoticeProperty,
  fitBridgeCrm,
} from '@stakes/contracts';

const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

// The bridge writes stakesBridge.crm and reads stakes.shipNotice, adding deliveredAt.
describe('cross-app contract, bridge side', () => {
  it('addresses the exact property keys the core app uses', () => {
    expect(SHIP_NOTICE_PROPERTY_KEY).toBe('stakes.shipNotice');
    expect(BRIDGE_CRM_PROPERTY_KEY).toBe('stakesBridge.crm');
  });

  it('round-trips the CRM value it writes, trimmed to fit the property', () => {
    const crm = fitBridgeCrm({
      deals: Array.from({ length: 80 }, (_, i) => ({
        id: `DEAL-${i}`,
        name: `Deal ${i}`,
        amountUsd: 1000 * i,
        stage: 'Proposal',
        probability: 0.4,
        closeDate: null,
        ownerAccountId: 'acc-1',
        customer: { id: `CUST-${i}`, name: `Customer ${i}`, tier: 'smb' as const },
      })),
      syncedAt: '2026-11-20T08:00:00.000Z',
    });
    expect(crm.deals).toHaveLength(50);
    expect(BridgeCrmProperty.parse(roundTrip(crm))).toEqual(crm);
  });

  it('round-trips a ship notice after marking it delivered', () => {
    const sent = ShipNoticeProperty.parse({
      status: 'sent',
      internalNote: 'Shipped',
      ownerAccountIds: [],
      sentAt: '2026-11-20T08:00:00.000Z',
    });
    const delivered = { ...sent, deliveredAt: '2026-11-20T08:04:00.000Z' };
    expect(ShipNoticeProperty.parse(roundTrip(delivered))).toEqual(delivered);
  });
});
