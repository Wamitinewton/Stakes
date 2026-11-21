import { describe, expect, it } from 'vitest';
import type { BridgeCrmProperty } from '@stakes/contracts';
import type { ConnectorCustomer, ConnectorDeal } from '../src/adapters/connector.js';
import type { HubspotCompany, HubspotDeal } from '../src/adapters/hubspot.js';
import {
  CONNECTION_KEY,
  HUBSPOT_TOKEN_KEY,
  PREVIOUS_SYNC_KEY,
  type BridgeStore,
  type PreviousSync,
} from '../src/adapters/storage.js';
import { runCrmSync, syncNow, type SyncDeps } from '../src/services/sync.js';

const company: HubspotCompany = {
  hubspotId: 'hs-company-1',
  id: 'CUST-007',
  name: 'Kilima Freight',
  tier: 'enterprise',
  arrUsd: 420000,
  renewalDate: '2027-03-31',
};

const deal: HubspotDeal = {
  id: 'DEAL-031',
  companyHubspotId: 'hs-company-1',
  name: 'Enterprise expansion',
  amountUsd: 220000,
  stage: 'Negotiation',
  probability: 0.6,
  closeDate: '2026-12-15',
  issueKeys: ['PAY-142'],
};

function harness(
  options: {
    companies?: HubspotCompany[];
    deals?: HubspotDeal[];
    previous?: PreviousSync;
    connectorRejected?: boolean;
  } = {},
) {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>([[HUBSPOT_TOKEN_KEY, 'stored-secret']]);
  values.set(CONNECTION_KEY, 'connection-1');
  if (options.previous) values.set(PREVIOUS_SYNC_KEY, options.previous);
  const store: BridgeStore = {
    getSecret: async (key) => secrets.get(key),
    setSecret: async (key, value) => void secrets.set(key, value),
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
  const pushedCustomers: ConnectorCustomer[][] = [];
  const pushedDeals: ConnectorDeal[][] = [];
  const deleted: Array<{ objectType: string; ids: string[] }> = [];
  const written = new Map<string, BridgeCrmProperty>();
  const cleared: string[] = [];
  const deps: SyncDeps = {
    store,
    hubspot: {
      listCompanies: async () => options.companies ?? [company],
      listDeals: async () => options.deals ?? [deal],
    },
    connector: {
      async pushCustomers(customers) {
        pushedCustomers.push(customers);
        return {
          accepted: customers.length,
          rejected: options.connectorRejected
            ? customers.map((id) => ({ id: id.id, reason: 'rejected' }))
            : [],
        };
      },
      async pushDeals(deals) {
        pushedDeals.push(deals);
        return { accepted: deals.length, rejected: [] };
      },
      async deleteObjects(objectType, ids) {
        deleted.push({ objectType, ids });
        return { failed: 0 };
      },
    },
    jira: {
      writeBridgeCrm: async (issueKey, value) => void written.set(issueKey, value),
      clearBridgeCrm: async (issueKey) => void cleared.push(issueKey),
    },
    clock: () => new Date('2026-11-19T12:00:00.000Z'),
  };
  return { deps, values, pushedCustomers, pushedDeals, deleted, written, cleared };
}

describe('CRM sync', () => {
  it('uses the same service for manual sync and maps graph objects and Jira properties', async () => {
    const h = harness({
      previous: { customerIds: ['CUST-OLD'], dealIds: ['DEAL-OLD'], issueKeys: ['PAY-OLD'] },
    });
    const result = await runCrmSync(h.deps);

    expect(syncNow).toBe(runCrmSync);
    expect(result).toMatchObject({
      ok: true,
      data: {
        lastSync: '2026-11-19T12:00:00.000Z',
        counts: { customers: 1, deals: 1, issues: 1 },
        lastErrorCode: null,
      },
    });
    expect(h.pushedCustomers[0]?.[0]?.issueKeys).toEqual(['PAY-142']);
    expect(h.pushedDeals[0]?.[0]).toMatchObject({ id: 'DEAL-031', customerName: 'Kilima Freight' });
    expect(h.deleted).toEqual([
      { objectType: 'atlassian:deal', ids: ['DEAL-OLD'] },
      { objectType: 'atlassian:customer-org', ids: ['CUST-OLD'] },
    ]);
    expect(h.written.get('PAY-142')?.deals[0]).toMatchObject({
      id: 'DEAL-031',
      amountUsd: 220000,
      customer: { id: 'CUST-007', tier: 'enterprise' },
    });
    expect(h.cleared).toEqual(['PAY-OLD']);
    expect(h.values.get(PREVIOUS_SYNC_KEY)).toEqual({
      customerIds: ['CUST-007'],
      dealIds: ['DEAL-031'],
      issueKeys: ['PAY-142'],
    });
  });

  it('deletes graph objects and clears properties when HubSpot becomes empty', async () => {
    const h = harness({
      companies: [],
      deals: [],
      previous: {
        customerIds: ['CUST-007'],
        dealIds: ['DEAL-031'],
        issueKeys: ['PAY-142'],
      },
    });

    const result = await runCrmSync(h.deps);

    expect(result.ok).toBe(true);
    expect(h.deleted).toEqual([
      { objectType: 'atlassian:deal', ids: ['DEAL-031'] },
      { objectType: 'atlassian:customer-org', ids: ['CUST-007'] },
    ]);
    expect(h.cleared).toEqual(['PAY-142']);
    expect(h.values.get(PREVIOUS_SYNC_KEY)).toEqual({
      customerIds: [],
      dealIds: [],
      issueKeys: [],
    });
  });

  it('keeps previous ids when the connector rejects a push', async () => {
    const previous = { customerIds: ['CUST-OLD'], dealIds: ['DEAL-OLD'], issueKeys: ['PAY-OLD'] };
    const h = harness({ previous, connectorRejected: true });

    const result = await runCrmSync(h.deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'CONNECTOR_REJECTED' } });
    expect(h.values.get(PREVIOUS_SYNC_KEY)).toEqual(previous);
    expect(h.written.size).toBe(0);
  });

  it('fits each Jira property to the contract limit', async () => {
    const h = harness({
      deals: Array.from({ length: 60 }, (_, index) => ({
        ...deal,
        id: `DEAL-${index}`,
        amountUsd: index + 1,
      })),
    });

    const result = await runCrmSync(h.deps);

    expect(result.ok).toBe(true);
    expect(h.written.get('PAY-142')?.deals).toHaveLength(50);
  });

  it('does not push deals without Jira links', async () => {
    const h = harness({ deals: [{ ...deal, issueKeys: [] }] });
    const result = await runCrmSync(h.deps);

    expect(result).toMatchObject({
      ok: true,
      data: { counts: { customers: 0, deals: 0, issues: 0 } },
    });
    expect(h.pushedCustomers[0]).toEqual([]);
    expect(h.pushedDeals[0]).toEqual([]);
  });
});
