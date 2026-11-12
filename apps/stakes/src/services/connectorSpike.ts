import type { IssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import {
  CUSTOMER_ORG_TYPE,
  DEAL_TYPE,
  toCustomerOrgObject,
  toDealObject,
  type Connector,
  type PushResult,
} from '../adapters/connector.js';
import type { ConnectionStore } from '../adapters/storage.js';
import type { GraphClient, GraphResult } from '../adapters/graph.js';

export interface ConnectorSpikeDeps {
  connector: Connector;
  connections: ConnectionStore;
  graph: GraphClient;
  clock: () => Date;
}

export interface ConnectorSpikeReport {
  pushed: PushResult;
  storedInGraph: { customer: boolean; deal: boolean };
  api: { echo: Outcome; dealReadBack: Outcome };
}

interface Outcome {
  ok: boolean;
  reason?: string;
  // A truncated copy of what came back, shown to the person running the spike so the
  // result can be written up. Spike objects are fictional, so this holds no real data.
  sample?: string;
}

export const SPIKE_CUSTOMER_ID = 'CUST-SPIKE';
export const SPIKE_DEAL_ID = 'DEAL-SPIKE';

// Candidate read-back of connector deals through the API. No curated field links a deal
// to a work item, so this calls a persisted query registered in the explorer under the
// same key; if registration or the traversal is impossible, the read comes back degraded.
export const DEAL_READBACK_QUERY = `query stakes_q1_deals($queryKey: String!, $queryParams: JSON) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    __typename
  }
}`;

const ECHO_QUERY = 'query stakes_spike_echo { echo(myString: "stakes") }';

function outcome<T>(result: GraphResult<T>): Outcome {
  const data = result.ok ? result.data : result.data;
  return {
    ok: result.ok,
    ...(result.ok ? {} : { reason: result.reason }),
    ...(data !== undefined ? { sample: JSON.stringify(data).slice(0, 1500) } : {}),
  };
}

export async function runConnectorSpike(
  deps: ConnectorSpikeDeps,
  issueKey: IssueKey,
  siteUrl: string,
): Promise<Result<ConnectorSpikeReport>> {
  const connectionId = await deps.connections.get();
  if (!connectionId) {
    return err(
      'UPSTREAM_DEGRADED',
      'The Stakes connector is not connected yet. Connect it in Atlassian administration first.',
    );
  }

  const now = deps.clock();
  const customer = toCustomerOrgObject(
    {
      id: SPIKE_CUSTOMER_ID,
      name: 'Spike Customer (demo)',
      tier: 'enterprise',
      arrUsd: 120000,
      renewalDate: '2027-03-31',
      issueKeys: [issueKey],
    },
    now,
    siteUrl,
  );
  const deal = toDealObject(
    {
      id: SPIKE_DEAL_ID,
      name: 'Spike Customer (demo) — expansion',
      customerName: 'Spike Customer (demo)',
      amountUsd: 50000,
      stage: 'Negotiation',
      closeDate: '2026-12-15',
      isClosed: false,
      issueKeys: [issueKey],
    },
    now,
    siteUrl,
  );

  const pushed = await deps.connector.push([customer, deal], connectionId);
  const [customerStored, dealStored, echo, dealReadBack] = await Promise.all([
    deps.connector.exists(CUSTOMER_ORG_TYPE, SPIKE_CUSTOMER_ID, connectionId),
    deps.connector.exists(DEAL_TYPE, SPIKE_DEAL_ID, connectionId),
    deps.graph.query('stakes_spike_echo', ECHO_QUERY, {}),
    deps.graph.query('stakes_q1_deals', DEAL_READBACK_QUERY, {
      queryKey: 'stakes_q1_deals',
      queryParams: { issueKey },
    }),
  ]);

  return ok({
    pushed,
    storedInGraph: { customer: customerStored, deal: dealStored },
    api: { echo: outcome(echo), dealReadBack: outcome(dealReadBack) },
  });
}
