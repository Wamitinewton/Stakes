import { graph, types } from '@forge/teamwork-graph';
import type { IssueKey, Tier } from '@stakes/contracts';

export interface ConnectorCustomer {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
  issueKeys: IssueKey[];
}

export interface ConnectorDeal {
  id: string;
  name: string;
  customerName: string;
  amountUsd: number;
  stage: string;
  closeDate: string | null;
  isClosed: boolean;
  issueKeys: IssueKey[];
}

export interface PushResult {
  accepted: number;
  rejected: Array<{ id: string; reason: string }>;
}

export const CUSTOMER_ORG_TYPE = 'atlassian:customer-org';
export const DEAL_TYPE = 'atlassian:deal';

const SITE_WIDE: types.Permissions = {
  accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }],
};

function associations(issueKeys: IssueKey[], at: string): types.Associations | undefined {
  if (issueKeys.length === 0) return undefined;
  return { lastUpdatedAt: at, set: [{ associationType: 'issueIdOrKeys', values: issueKeys }] };
}

export function toCustomerOrgObject(c: ConnectorCustomer, now: Date): types.CustomerOrgObject {
  const at = now.toISOString();
  const links = associations(c.issueKeys, at);
  return {
    schemaVersion: '2.0',
    id: c.id,
    updateSequenceNumber: now.getTime(),
    displayName: c.name,
    url: `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(c.id)}`,
    createdAt: at,
    lastUpdatedAt: at,
    permissions: SITE_WIDE,
    ...(links ? { associations: links } : {}),
    'atlassian:customer-org': {
      customerSegment: c.tier,
      customerOrgLifeTimeValue: { value: c.arrUsd, currencyCode: 'USD' },
      ...(c.renewalDate ? { status: `renews ${c.renewalDate}` } : {}),
    },
  };
}

export function toDealObject(d: ConnectorDeal, now: Date): types.DealObject {
  const at = now.toISOString();
  const links = associations(d.issueKeys, at);
  return {
    schemaVersion: '2.0',
    id: d.id,
    updateSequenceNumber: now.getTime(),
    displayName: d.name,
    url: `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(d.id)}`,
    createdAt: at,
    lastUpdatedAt: at,
    permissions: SITE_WIDE,
    ...(links ? { associations: links } : {}),
    'atlassian:deal': {
      stage: d.stage,
      accountName: d.customerName,
      isClosed: d.isClosed,
      opportunityAmount: { value: d.amountUsd, currencyCode: 'USD' },
      ...(d.closeDate ? { dealClosedAt: `${d.closeDate}T00:00:00Z` } : {}),
    },
  };
}

export function summarisePush(response: types.BulkObjectResponse, sentIds: string[]): PushResult {
  if (!response.success && !response.results) {
    return {
      accepted: 0,
      rejected: sentIds.map((id) => ({ id, reason: response.error ?? 'request failed' })),
    };
  }
  return {
    accepted: response.results?.accepted?.length ?? 0,
    rejected: (response.results?.rejected ?? []).map((r) => ({
      id: Object.values(r.key?.entityId ?? {}).join('/') || 'unknown',
      reason: r.errors?.map((e) => e.message).join('; ') || 'rejected',
    })),
  };
}

type GraphSdk = Pick<typeof graph, 'setObjects' | 'deleteObjectsByExternalId'>;

function chunks<T>(items: T[]): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += 100) output.push(items.slice(i, i + 100));
  return output;
}

export interface Connector {
  pushCustomers(customers: ConnectorCustomer[], connectionId: string): Promise<PushResult>;
  pushDeals(deals: ConnectorDeal[], connectionId: string): Promise<PushResult>;
  deleteObjects(
    objectType: string,
    externalIds: string[],
    connectionId: string,
  ): Promise<{ failed: number }>;
}

export function makeConnector(
  sdk: GraphSdk = graph,
  clock: () => Date = () => new Date(),
): Connector {
  const push = async (objects: types.Object[], connectionId: string): Promise<PushResult> => {
    const total: PushResult = { accepted: 0, rejected: [] };
    for (const part of chunks(objects)) {
      const result = summarisePush(
        await sdk.setObjects({ objects: part, connectionId }),
        part.map((object) => object.id),
      );
      total.accepted += result.accepted;
      total.rejected.push(...result.rejected);
    }
    if (total.rejected.length > 0) {
      console.warn('connector rejected objects', { count: total.rejected.length });
    }
    return total;
  };

  return {
    pushCustomers(customers, connectionId) {
      const now = clock();
      return push(
        customers.map((customer) => toCustomerOrgObject(customer, now)),
        connectionId,
      );
    },
    pushDeals(deals, connectionId) {
      const now = clock();
      return push(
        deals.map((deal) => toDealObject(deal, now)),
        connectionId,
      );
    },
    async deleteObjects(objectType, externalIds, connectionId) {
      let failed = 0;
      for (const part of chunks(externalIds)) {
        const result = await sdk.deleteObjectsByExternalId({
          objectType,
          externalIds: part,
          connectionId,
        });
        if (!result.success) failed += part.length;
      }
      if (failed) console.warn('connector delete failed', { objectType, count: failed });
      return { failed };
    },
  };
}
