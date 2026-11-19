import { describe, expect, it } from 'vitest';
import companiesPage1 from './fixtures/hubspot/happy.companies.1.json';
import companiesPage2 from './fixtures/hubspot/happy.companies.2.json';
import deals from './fixtures/hubspot/happy.deals.json';
import empty from './fixtures/hubspot/empty.json';
import unauthorized from './fixtures/hubspot/401.json';
import rateLimited from './fixtures/hubspot/rate-limited.json';
import { makeHubspotClient, type Fetch } from '../src/adapters/hubspot.js';

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('HubSpot client fixtures', () => {
  it('reads every company page and maps deal links and issue keys', async () => {
    const urls: string[] = [];
    const http: Fetch = async (url) => {
      urls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/companies')) {
        return respond(parsed.searchParams.get('after') ? companiesPage2 : companiesPage1);
      }
      return respond(deals);
    };
    const client = makeHubspotClient(http);

    const companies = await client.listCompanies('test-token');
    const mappedDeals = await client.listDeals('test-token');

    expect(companies.map((company) => company.id)).toEqual(['CUST-007', 'CUST-012']);
    expect(mappedDeals).toEqual([
      {
        id: 'DEAL-031',
        companyHubspotId: 'hs-company-1',
        name: 'Enterprise expansion',
        amountUsd: 220000,
        stage: 'Negotiation',
        probability: 0.6,
        closeDate: '2026-12-15',
        issueKeys: ['PAY-142', 'PAY-118'],
      },
    ]);
    expect(urls.filter((url) => url.includes('/companies'))).toHaveLength(2);
    expect(urls[0]).not.toContain('test-token');
  });

  it('accepts an empty page', async () => {
    const client = makeHubspotClient(async () => respond(empty));
    expect(await client.listCompanies('test-token')).toEqual([]);
  });

  it('classifies 401 without exposing the response or token', async () => {
    const client = makeHubspotClient(async () => respond(unauthorized, 401));
    await expect(client.listCompanies('test-token')).rejects.toMatchObject({
      code: 'HUBSPOT_AUTH_FAILED',
      message: 'HUBSPOT_AUTH_FAILED',
    });
  });

  it('classifies rate limiting', async () => {
    const client = makeHubspotClient(async () => respond(rateLimited, 429));
    await expect(client.listDeals('test-token')).rejects.toMatchObject({
      code: 'HUBSPOT_RATE_LIMITED',
    });
  });
});
