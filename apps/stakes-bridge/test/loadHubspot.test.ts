import { describe, expect, it } from 'vitest';
import { readDemoData, runLoader } from '../scripts/load-hubspot.js';
import type { Fetch, HttpResponse } from '../src/adapters/hubspot.js';

const response = (body: unknown, status = 200): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function hubspotFake() {
  const records = new Map<string, { id: string; properties: Record<string, unknown> }>();
  const associations: string[] = [];
  let nextId = 1;
  let missingAuth = 0;

  const http: Fetch = async (url, init) => {
    if (init?.headers?.Authorization !== 'Bearer environment-only-token') missingAuth++;
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (path.startsWith('/crm/v3/properties/')) return response({ name: 'existing' });
    if (path.endsWith('/search')) {
      const objectType = path.split('/')[4]!;
      const filters = body.filterGroups as Array<{
        filters: Array<{ value: string }>;
      }>;
      const externalId = filters[0]!.filters[0]!.value;
      const existing = records.get(`${objectType}:${externalId}`);
      return response({ results: existing ? [{ id: existing.id }] : [] });
    }
    if (path.includes('/associations/default/')) {
      associations.push(path);
      return response(null);
    }

    const match = path.match(/^\/crm\/v3\/objects\/(companies|deals)(?:\/(\d+))?$/);
    if (match) {
      const objectType = match[1]!;
      const properties = body.properties as Record<string, unknown>;
      if (init?.method === 'PATCH') {
        const record = [...records.values()].find((item) => item.id === match[2]);
        if (!record) return response(null, 404);
        record.properties = properties;
        return response(record);
      }
      const id = String(nextId++);
      const record = { id, properties };
      records.set(`${objectType}:${String(properties.stakes_external_id)}`, record);
      return response(record);
    }
    return response(null, 404);
  };

  return { http, records, associations, missingAuth: () => missingAuth };
}

describe('HubSpot demo loader', () => {
  it('reads the existing eight customers and twelve linked deals', async () => {
    const data = await readDemoData();
    expect(data.customers).toHaveLength(8);
    expect(data.deals).toHaveLength(12);
    expect(data.deals.every((deal) => deal.issueKeys.length > 0)).toBe(true);
  });

  it('creates then updates records without duplicating them', async () => {
    const fake = hubspotFake();
    const options = { token: 'environment-only-token', http: fake.http };

    const first = await runLoader(options);
    const second = await runLoader(options);

    expect(first).toEqual({ companies: 8, deals: 12, created: 20, updated: 0 });
    expect(second).toEqual({ companies: 8, deals: 12, created: 0, updated: 20 });
    expect(fake.records).toHaveLength(20);
    expect(fake.associations).toHaveLength(24);
    expect(fake.missingAuth()).toBe(0);

    const source = await readDemoData();
    for (const deal of source.deals) {
      const stored = fake.records.get(`deals:${deal.id}`);
      expect(stored?.properties.jira_issue_keys).toBe(deal.issueKeys.join(';'));
      expect(stored?.properties.stakes_external_id).toBe(deal.id);
      expect(stored?.properties.stakes_stage).toBe(deal.stage);
    }
  });
});
