import { BridgeCrmProperty, fitBridgeCrm, type BridgeDeal, type IssueKey } from '@stakes/contracts';
import {
  CUSTOMER_ORG_TYPE,
  DEAL_TYPE,
  type Connector,
  type ConnectorCustomer,
} from '../adapters/connector.js';
import {
  HubspotError,
  type HubspotClient,
  type HubspotCompany,
  type HubspotDeal,
} from '../adapters/hubspot.js';
import type { JiraBridge } from '../adapters/jira.js';
import {
  CONNECTION_KEY,
  HUBSPOT_TOKEN_KEY,
  PREVIOUS_SYNC_KEY,
  SYNC_STATUS_KEY,
  syncStatus,
  type BridgeStore,
  type PreviousSync,
} from '../adapters/storage.js';
import { err, ok, type Result } from '../core/result.js';
import { getStatus, type BridgeStatus } from './settings.js';

export interface SyncDeps {
  store: BridgeStore;
  hubspot: Pick<HubspotClient, 'listCompanies' | 'listDeals'>;
  connector: Connector;
  jira: Pick<JiraBridge, 'writeBridgeCrm' | 'clearBridgeCrm'>;
  clock: () => Date;
}

export interface MappedDeal extends BridgeDeal {
  issueKeys: IssueKey[];
}

export function mapCrm(companies: HubspotCompany[], deals: HubspotDeal[]) {
  const linkedDeals = deals.filter((deal) => deal.issueKeys.length > 0);
  const companiesByHubspotId = new Map(companies.map((company) => [company.hubspotId, company]));
  const mappedDeals = linkedDeals.flatMap((deal): MappedDeal[] => {
    const customer = deal.companyHubspotId
      ? companiesByHubspotId.get(deal.companyHubspotId)
      : undefined;
    if (!customer) return [];
    return [
      {
        id: deal.id,
        name: deal.name,
        amountUsd: deal.amountUsd,
        stage: deal.stage,
        probability: deal.probability,
        closeDate: deal.closeDate,
        ownerAccountId: null,
        customer: { id: customer.id, name: customer.name, tier: customer.tier },
        issueKeys: deal.issueKeys,
      },
    ];
  });

  const wantedCustomerIds = new Set(mappedDeals.map((deal) => deal.customer.id));
  const customers: ConnectorCustomer[] = companies
    .filter((company) => wantedCustomerIds.has(company.id))
    .map((company) => ({
      id: company.id,
      name: company.name,
      tier: company.tier,
      arrUsd: company.arrUsd,
      renewalDate: company.renewalDate,
      issueKeys: [
        ...new Set(
          mappedDeals
            .filter((deal) => deal.customer.id === company.id)
            .flatMap((deal) => deal.issueKeys),
        ),
      ],
    }));
  return { customers, deals: mappedDeals };
}

export function dealsByIssue(deals: MappedDeal[]): Map<IssueKey, BridgeDeal[]> {
  const grouped = new Map<IssueKey, BridgeDeal[]>();
  for (const { issueKeys, ...deal } of deals) {
    for (const issueKey of issueKeys) {
      grouped.set(issueKey, [...(grouped.get(issueKey) ?? []), deal]);
    }
  }
  return grouped;
}

async function failed(
  deps: Pick<SyncDeps, 'store'>,
  code: string,
  message: string,
): Promise<Result<BridgeStatus>> {
  const status = await syncStatus(deps.store);
  await deps.store.set(SYNC_STATUS_KEY, { ...status, lastErrorCode: code });
  return err(code, message);
}

const difference = (left: string[], right: Set<string>) => left.filter((id) => !right.has(id));

export async function runCrmSync(deps: SyncDeps): Promise<Result<BridgeStatus>> {
  const token = await deps.store.getSecret(HUBSPOT_TOKEN_KEY);
  if (!token) return failed(deps, 'HUBSPOT_NOT_CONFIGURED', 'Save a HubSpot token first.');
  const connectionId = await deps.store.get<string>(CONNECTION_KEY);
  if (!connectionId) {
    return failed(
      deps,
      'CONNECTOR_NOT_CONNECTED',
      'Connect the bridge CRM connector in Atlassian administration first.',
    );
  }

  try {
    const [rawCompanies, rawDeals] = await Promise.all([
      deps.hubspot.listCompanies(token),
      deps.hubspot.listDeals(token),
    ]);
    const mapped = mapCrm(rawCompanies, rawDeals);
    const previous = (await deps.store.get<PreviousSync>(PREVIOUS_SYNC_KEY)) ?? {
      customerIds: [],
      dealIds: [],
      issueKeys: [],
    };

    const pushedCustomers = await deps.connector.pushCustomers(mapped.customers, connectionId);
    const pushedDeals = await deps.connector.pushDeals(
      mapped.deals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        customerName: deal.customer.name,
        amountUsd: deal.amountUsd,
        stage: deal.stage,
        closeDate: deal.closeDate,
        isClosed: deal.stage.toLowerCase().startsWith('closed'),
        issueKeys: deal.issueKeys,
      })),
      connectionId,
    );
    if (pushedCustomers.rejected.length + pushedDeals.rejected.length > 0) {
      return failed(deps, 'CONNECTOR_REJECTED', 'The CRM connector rejected some objects.');
    }

    const deletedDeals = difference(previous.dealIds, new Set(mapped.deals.map((d) => d.id)));
    const deletedCustomers = difference(
      previous.customerIds,
      new Set(mapped.customers.map((c) => c.id)),
    );
    const dealDelete = await deps.connector.deleteObjects(DEAL_TYPE, deletedDeals, connectionId);
    const customerDelete = await deps.connector.deleteObjects(
      CUSTOMER_ORG_TYPE,
      deletedCustomers,
      connectionId,
    );
    if (dealDelete.failed + customerDelete.failed > 0) {
      return failed(
        deps,
        'CONNECTOR_DELETE_FAILED',
        'Some removed CRM objects could not be deleted.',
      );
    }

    const grouped = dealsByIssue(mapped.deals);
    const syncedAt = deps.clock().toISOString();
    for (const [issueKey, deals] of grouped) {
      const property = BridgeCrmProperty.parse(fitBridgeCrm({ deals, syncedAt }));
      await deps.jira.writeBridgeCrm(issueKey, property);
    }
    for (const issueKey of difference(previous.issueKeys, new Set(grouped.keys()))) {
      await deps.jira.clearBridgeCrm(issueKey);
    }

    const current: PreviousSync = {
      customerIds: mapped.customers.map((customer) => customer.id),
      dealIds: mapped.deals.map((deal) => deal.id),
      issueKeys: [...grouped.keys()],
    };
    await deps.store.set(PREVIOUS_SYNC_KEY, current);
    await deps.store.set(SYNC_STATUS_KEY, {
      lastSync: syncedAt,
      counts: {
        customers: mapped.customers.length,
        deals: mapped.deals.length,
        issues: grouped.size,
      },
      lastErrorCode: null,
    });
    console.log('bridge CRM sync complete', {
      customers: mapped.customers.length,
      deals: mapped.deals.length,
      issues: grouped.size,
      deletedDeals: deletedDeals.length,
      deletedCustomers: deletedCustomers.length,
    });
    return ok(await getStatus(deps));
  } catch (error) {
    const code = error instanceof HubspotError ? error.code : 'SYNC_FAILED';
    return failed(deps, code, 'CRM sync failed. Check the connection and try again.');
  }
}

export const syncNow = runCrmSync;
