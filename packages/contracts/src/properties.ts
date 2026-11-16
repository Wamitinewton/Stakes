import { z } from 'zod';

// The two apps never share Forge storage. Jira issue entity properties are the only
// place both can read and write, so these keys are the whole cross-app channel.
export const SHIP_NOTICE_PROPERTY_KEY = 'stakes.shipNotice';
export const BRIDGE_CRM_PROPERTY_KEY = 'stakesBridge.crm';

// JQL cannot address a property key containing a dot, so the indexed copy of the
// ship notice is exposed under this alias.
export const SHIP_NOTICE_JQL_ALIAS = 'stakesShipNotice';

export const TierSchema = z.enum(['enterprise', 'mid-market', 'smb']);

export const ShipNoticeProperty = z.object({
  status: z.enum(['sent']),
  internalNote: z.string().max(2000),
  ownerAccountIds: z.array(z.string()),
  sentAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().optional(),
});
export type ShipNoticeProperty = z.infer<typeof ShipNoticeProperty>;

export const BridgeDeal = z.object({
  id: z.string(),
  name: z.string(),
  amountUsd: z.number().nonnegative(),
  stage: z.string(),
  probability: z.number().min(0).max(1),
  closeDate: z.iso.date().nullable(),
  ownerAccountId: z.string().nullable(),
  customer: z.object({ id: z.string(), name: z.string(), tier: TierSchema }),
});
export type BridgeDeal = z.infer<typeof BridgeDeal>;

export const BridgeCrmProperty = z.object({
  deals: z.array(BridgeDeal),
  syncedAt: z.iso.datetime(),
});
export type BridgeCrmProperty = z.infer<typeof BridgeCrmProperty>;

// Jira rejects an entity property value above 32 KB.
export const ISSUE_PROPERTY_MAX_BYTES = 32 * 1024;
export const BRIDGE_CRM_MAX_DEALS = 50;

// UTF-8 length without TextEncoder or Buffer, so the same code runs in the backend and
// in UI bundles. Surrogate pairs count as four bytes, the way Jira measures them.
function byteLength(value: unknown): number {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// The largest deals carry most of the revenue signal, so when an issue blocks more deals
// than a property can hold, the small ones are dropped first. If 50 deals still exceed
// the limit (very long names), deals keep being dropped from the bottom until it fits.
export function fitBridgeCrm(value: BridgeCrmProperty): BridgeCrmProperty {
  const deals = [...value.deals]
    .sort((a, b) => b.amountUsd - a.amountUsd || a.id.localeCompare(b.id))
    .slice(0, BRIDGE_CRM_MAX_DEALS);
  const fitted = { deals, syncedAt: value.syncedAt };
  while (fitted.deals.length > 0 && byteLength(fitted) >= ISSUE_PROPERTY_MAX_BYTES) {
    fitted.deals.pop();
  }
  return fitted;
}

export function bridgeCrmByteLength(value: BridgeCrmProperty): number {
  return byteLength(value);
}
