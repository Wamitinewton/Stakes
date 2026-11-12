import { describe, expect, it } from 'vitest';
import { BRIDGE_CRM_PROPERTY_KEY, SHIP_NOTICE_PROPERTY_KEY } from '@stakes/contracts';

// The bridge must address the exact property keys the core app writes and reads.
describe('cross-app property keys', () => {
  it('matches the keys the core app uses', () => {
    expect(SHIP_NOTICE_PROPERTY_KEY).toBe('stakes.shipNotice');
    expect(BRIDGE_CRM_PROPERTY_KEY).toBe('stakesBridge.crm');
  });
});
