import { graph, types } from '@forge/teamwork-graph';
import type { IssueKey } from '@stakes/contracts';
import { customerUrl, dealUrl } from '../core/links.js';

export type Tier = 'enterprise' | 'mid-market' | 'smb';

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

// Every object is readable by anyone on the site. Stakes does not replicate CRM
// permissions; it only ingests what an admin chose to import.
const SITE_WIDE: types.Permissions = {
  accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }],
};

// A relationship only exists in the graph if it is sent with the object, and `set`
// replaces the whole list, so every push carries every linked issue key.
function issueAssociations(issueKeys: IssueKey[], at: string): types.Associations | undefined {
  if (issueKeys.length === 0) return undefined;
  return { lastUpdatedAt: at, set: [{ associationType: 'issueIdOrKeys', values: issueKeys }] };
}

// The graph keeps the newest updateSequenceNumber, so a later re-import always wins.
const sequence = (now: Date) => now.getTime();

export function toCustomerOrgObject(
  c: ConnectorCustomer,
  now: Date,
  siteUrl: string,
): types.CustomerOrgObject {
  const at = now.toISOString();
  const associations = issueAssociations(c.issueKeys, at);
  return {
    schemaVersion: '2.0',
    id: c.id,
    updateSequenceNumber: sequence(now),
    displayName: c.name,
    url: customerUrl(siteUrl, c.id),
    createdAt: at,
    lastUpdatedAt: at,
    permissions: SITE_WIDE,
    ...(associations ? { associations } : {}),
    'atlassian:customer-org': {
      customerSegment: c.tier,
      customerOrgLifeTimeValue: { value: c.arrUsd, currencyCode: 'USD' },
      ...(c.renewalDate ? { status: `renews ${c.renewalDate}` } : {}),
    },
  };
}

export function toDealObject(d: ConnectorDeal, now: Date, siteUrl: string): types.DealObject {
  const at = now.toISOString();
  const associations = issueAssociations(d.issueKeys, at);
  return {
    schemaVersion: '2.0',
    id: d.id,
    updateSequenceNumber: sequence(now),
    displayName: d.name,
    url: dealUrl(siteUrl, d.id),
    createdAt: at,
    lastUpdatedAt: at,
    permissions: SITE_WIDE,
    ...(associations ? { associations } : {}),
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
  const rejected = (response.results?.rejected ?? []).map((r) => ({
    id: Object.values(r.key?.entityId ?? {}).join('/') || 'unknown',
    reason: r.errors?.map((e) => e.message).join('; ') || 'rejected',
  }));
  return { accepted: response.results?.accepted?.length ?? 0, rejected };
}

type GraphSdk = Pick<
  typeof graph,
  'setObjects' | 'getObjectByExternalId' | 'deleteObjectsByExternalId'
>;

// The graph accepts at most 100 objects per setObjects call.
export const PUSH_CHUNK = 100;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Connector {
  push(objects: types.Object[], connectionId: string): Promise<PushResult>;
  pushCustomers(
    customers: ConnectorCustomer[],
    connectionId: string,
    siteUrl: string,
  ): Promise<PushResult>;
  pushDeals(deals: ConnectorDeal[], connectionId: string, siteUrl: string): Promise<PushResult>;
  deleteObjects(
    objectType: string,
    externalIds: string[],
    connectionId: string,
  ): Promise<{ failed: number }>;
  exists(objectType: string, externalId: string, connectionId: string): Promise<boolean>;
}

export function makeConnector(
  sdk: GraphSdk = graph,
  clock: () => Date = () => new Date(),
): Connector {
  const connector: Connector = {
    async push(objects, connectionId) {
      const total: PushResult = { accepted: 0, rejected: [] };
      for (const part of chunked(objects, PUSH_CHUNK)) {
        const ids = part.map((o) => o.id);
        const result = summarisePush(await sdk.setObjects({ objects: part, connectionId }), ids);
        total.accepted += result.accepted;
        total.rejected.push(...result.rejected);
      }
      // Ids and reasons only: names and amounts never go to the logs.
      for (const r of total.rejected) console.warn('connector rejected object', r);
      return total;
    },
    async pushCustomers(customers, connectionId, siteUrl) {
      const now = clock();
      return connector.push(
        customers.map((c) => toCustomerOrgObject(c, now, siteUrl)),
        connectionId,
      );
    },
    async pushDeals(deals, connectionId, siteUrl) {
      const now = clock();
      return connector.push(
        deals.map((d) => toDealObject(d, now, siteUrl)),
        connectionId,
      );
    },
    async deleteObjects(objectType, externalIds, connectionId) {
      let failed = 0;
      for (const part of chunked(externalIds, PUSH_CHUNK)) {
        const res = await sdk.deleteObjectsByExternalId({
          objectType,
          externalIds: part,
          connectionId,
        });
        if (!res.success) {
          failed += part.length;
          console.warn('connector delete failed', { objectType, count: part.length });
        }
      }
      return { failed };
    },
    async exists(objectType, externalId, connectionId) {
      const res = await sdk.getObjectByExternalId({ objectType, externalId, connectionId });
      return res.success && Boolean(res.object);
    },
  };
  return connector;
}
