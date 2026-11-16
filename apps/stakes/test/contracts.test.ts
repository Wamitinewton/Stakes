import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CRM_PROPERTY_KEY,
  BridgeCrmProperty,
  SHIP_NOTICE_PROPERTY_KEY,
  ShipNoticeProperty,
  fitBridgeCrm,
} from '@stakes/contracts';

// The core app writes stakes.shipNotice and reads stakesBridge.crm. Each shape must
// survive a write and a read through JSON exactly as the bridge sees it.
const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe('cross-app contract, core side', () => {
  it('uses the agreed property keys', () => {
    expect(SHIP_NOTICE_PROPERTY_KEY).toBe('stakes.shipNotice');
    expect(BRIDGE_CRM_PROPERTY_KEY).toBe('stakesBridge.crm');
  });

  it('round-trips a ship notice it writes', () => {
    const notice = ShipNoticeProperty.parse({
      status: 'sent',
      internalNote: 'PAY-142 shipped in 2026.12',
      ownerAccountIds: ['acc-1', 'acc-2'],
      sentAt: '2026-11-20T08:00:00.000Z',
    });
    expect(ShipNoticeProperty.parse(roundTrip(notice))).toEqual(notice);
  });

  it('round-trips the bridge CRM value it reads, after the size guard', () => {
    const crm = fitBridgeCrm({
      deals: [
        {
          id: 'DEAL-031',
          name: 'Expansion',
          amountUsd: 220000,
          stage: 'Negotiation',
          probability: 0.6,
          closeDate: '2026-12-15',
          ownerAccountId: null,
          customer: { id: 'CUST-007', name: 'Example Freight', tier: 'enterprise' },
        },
      ],
      syncedAt: '2026-11-20T08:00:00.000Z',
    });
    expect(BridgeCrmProperty.parse(roundTrip(crm))).toEqual(crm);
  });
});
