import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Fetch } from '../src/adapters/hubspot.js';

interface DemoCustomer {
  id: string;
  name: string;
  tier: 'enterprise' | 'mid-market' | 'smb';
  arrUsd: number;
  renewalDate: string;
}

interface DemoDeal {
  id: string;
  name: string;
  customerId: string;
  amountUsd: number;
  stage: string;
  probability: number;
  closeDate: string;
  issueKeys: string[];
}

interface DemoData {
  customers: DemoCustomer[];
  deals: DemoDeal[];
}

interface Logger {
  log(message: string): void;
}

const DEMO_DATA = new URL('../../stakes/scripts/demo-data/', import.meta.url);
const API_ROOT = 'https://api.hubapi.com';

const PIPELINE_STAGE: Record<string, string> = {
  Discovery: 'appointmentscheduled',
  Qualification: 'qualifiedtobuy',
  Proposal: 'presentationscheduled',
  Negotiation: 'decisionmakerboughtin',
  Commit: 'contractsent',
  'Closed Won': 'closedwon',
};

const PROPERTIES = {
  companies: [
    ['stakes_external_id', 'Stakes external ID', 'string', 'text'],
    ['stakes_tier', 'Stakes tier', 'string', 'text'],
    ['stakes_arr_usd', 'Stakes ARR USD', 'number', 'number'],
    ['stakes_renewal_date', 'Stakes renewal date', 'date', 'date'],
  ],
  deals: [
    ['stakes_external_id', 'Stakes external ID', 'string', 'text'],
    ['jira_issue_keys', 'Jira issue keys', 'string', 'text'],
    ['stakes_stage', 'Stakes stage', 'string', 'text'],
    ['stakes_probability', 'Stakes probability', 'number', 'number'],
  ],
} as const;

function records(value: unknown, file: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object')) {
    throw new Error(`Invalid demo data in ${file}`);
  }
  return value as Record<string, unknown>[];
}

function required(row: Record<string, unknown>, fields: string[], file: string): void {
  if (fields.some((field) => typeof row[field] !== 'string' || row[field] === '')) {
    throw new Error(`Missing demo data field in ${file}`);
  }
}

export async function readDemoData(dataDir: URL = DEMO_DATA): Promise<DemoData> {
  const [customersJson, dealsJson] = await Promise.all([
    readFile(new URL('customers.json', dataDir), 'utf8'),
    readFile(new URL('deals.json', dataDir), 'utf8'),
  ]);
  const customers = records(JSON.parse(customersJson), 'customers.json');
  const deals = records(JSON.parse(dealsJson), 'deals.json');
  for (const row of customers) {
    required(row, ['id', 'name', 'tier', 'renewalDate'], 'customers.json');
    if (typeof row.arrUsd !== 'number') throw new Error('Invalid customer amount');
  }
  for (const row of deals) {
    required(row, ['id', 'name', 'customerId', 'stage', 'closeDate'], 'deals.json');
    if (
      typeof row.amountUsd !== 'number' ||
      typeof row.probability !== 'number' ||
      !Array.isArray(row.issueKeys) ||
      row.issueKeys.some((key) => typeof key !== 'string')
    ) {
      throw new Error('Invalid deal data');
    }
  }
  return {
    customers: customers as unknown as DemoCustomer[],
    deals: deals as unknown as DemoDeal[],
  };
}

export async function runLoader(options: {
  token: string;
  http: Fetch;
  data?: DemoData;
  logger?: Logger;
}): Promise<{ companies: number; deals: number; created: number; updated: number }> {
  const { token, http } = options;
  const data = options.data ?? (await readDemoData());
  const logger = options.logger ?? { log: () => {} };
  let created = 0;
  let updated = 0;

  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await http(`${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`HubSpot request failed with HTTP ${response.status}`);
    return response.status === 204 ? null : await response.json().catch(() => null);
  };

  for (const objectType of ['companies', 'deals'] as const) {
    const groupName = objectType === 'companies' ? 'companyinformation' : 'dealinformation';
    for (const [name, label, type, fieldType] of PROPERTIES[objectType]) {
      const path = `/crm/v3/properties/${objectType}/${name}`;
      const response = await http(`${API_ROOT}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (response.status === 404) {
        await request(path, 'POST', { name, label, groupName, type, fieldType });
      } else if (!response.ok) {
        throw new Error(`HubSpot property check failed with HTTP ${response.status}`);
      }
    }
  }

  const upsert = async (
    objectType: 'companies' | 'deals',
    externalId: string,
    properties: Record<string, string | number>,
  ): Promise<string> => {
    const found = (await request(`/crm/v3/objects/${objectType}/search`, 'POST', {
      filterGroups: [
        { filters: [{ propertyName: 'stakes_external_id', operator: 'EQ', value: externalId }] },
      ],
      properties: ['stakes_external_id'],
      limit: 1,
    })) as { results?: Array<{ id?: string }> } | null;
    const existingId = found?.results?.[0]?.id;
    if (existingId) {
      await request(`/crm/v3/objects/${objectType}/${existingId}`, 'PATCH', { properties });
      updated++;
      return existingId;
    }
    const result = (await request(`/crm/v3/objects/${objectType}`, 'POST', { properties })) as {
      id?: string;
    } | null;
    if (!result?.id) throw new Error('HubSpot create returned no record id');
    created++;
    return result.id;
  };

  const companyIds = new Map<string, string>();
  for (const customer of data.customers) {
    const id = await upsert('companies', customer.id, {
      name: customer.name,
      stakes_external_id: customer.id,
      stakes_tier: customer.tier,
      stakes_arr_usd: customer.arrUsd,
      stakes_renewal_date: customer.renewalDate,
    });
    companyIds.set(customer.id, id);
  }

  for (const deal of data.deals) {
    const companyId = companyIds.get(deal.customerId);
    if (!companyId) throw new Error('Demo deal refers to an unknown company');
    const dealId = await upsert('deals', deal.id, {
      dealname: deal.name,
      amount: deal.amountUsd,
      dealstage: PIPELINE_STAGE[deal.stage] ?? 'appointmentscheduled',
      closedate: deal.closeDate,
      stakes_external_id: deal.id,
      stakes_stage: deal.stage,
      stakes_probability: deal.probability,
      jira_issue_keys: deal.issueKeys.join(';'),
    });
    await request(
      `/crm/v4/objects/deals/${dealId}/associations/default/companies/${companyId}`,
      'PUT',
    );
  }

  logger.log(
    `HubSpot demo load complete: ${data.customers.length} companies, ${data.deals.length} deals, ${created} created, ${updated} updated`,
  );
  return { companies: data.customers.length, deals: data.deals.length, created, updated };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const token = process.env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    console.error('Set HUBSPOT_TOKEN in the environment before running the loader.');
    process.exitCode = 1;
  } else {
    try {
      await runLoader({
        token,
        http: (url, init) => globalThis.fetch(url, init),
        logger: console,
      });
    } catch {
      console.error('HubSpot demo load failed. No credentials were written or displayed.');
      process.exitCode = 1;
    }
  }
}
