import { graph, types } from '@forge/teamwork-graph';
import type { IssueKey } from '@stakes/contracts';

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
    url: `${siteUrl}/jira/apps/stakes/customer/${encodeURIComponent(c.id)}`,
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
    url: `${siteUrl}/jira/apps/stakes/deal/${encodeURIComponent(d.id)}`,
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

type GraphSdk = Pick<typeof graph, 'setObjects' | 'getObjectByExternalId'>;

export interface Connector {
  push(objects: types.Object[], connectionId: string): Promise<PushResult>;
  exists(objectType: string, externalId: string, connectionId: string): Promise<boolean>;
}

export function makeConnector(sdk: GraphSdk = graph): Connector {
  return {
    async push(objects, connectionId) {
      const ids = objects.map((o) => o.id);
      const result = summarisePush(await sdk.setObjects({ objects, connectionId }), ids);
      // Ids and reasons only: names and amounts never go to the logs.
      for (const r of result.rejected) console.warn('connector rejected object', r);
      return result;
    },
    async exists(objectType, externalId, connectionId) {
      const res = await sdk.getObjectByExternalId({ objectType, externalId, connectionId });
      return res.success && Boolean(res.object);
    },
  };
}
