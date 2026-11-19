import { fetch } from '@forge/api';
import { isIssueKey, type IssueKey, type Tier } from '@stakes/contracts';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export class HubspotError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HubspotError';
  }
}

export interface HubspotCompany {
  hubspotId: string;
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
}

export interface HubspotDeal {
  id: string;
  companyHubspotId: string | null;
  name: string;
  amountUsd: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  issueKeys: IssueKey[];
}

export interface HubspotClient {
  test(token: string): Promise<void>;
  listCompanies(token: string): Promise<HubspotCompany[]>;
  listDeals(token: string): Promise<HubspotDeal[]>;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.map(obj) : []);
const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const date = (value: unknown): string | null => {
  const text = str(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const COMPANY_PROPERTIES = [
  'name',
  'stakes_external_id',
  'stakes_tier',
  'stakes_arr_usd',
  'stakes_renewal_date',
];
const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'dealstage',
  'closedate',
  'stakes_external_id',
  'stakes_stage',
  'stakes_probability',
  'jira_issue_keys',
];

export function parseCompany(record: unknown): HubspotCompany {
  const row = obj(record);
  const properties = obj(row.properties);
  const hubspotId = str(row.id);
  const tier = str(properties.stakes_tier);
  return {
    hubspotId,
    id: str(properties.stakes_external_id) || hubspotId,
    name: str(properties.name),
    tier: tier === 'enterprise' || tier === 'mid-market' || tier === 'smb' ? tier : 'smb',
    arrUsd: number(properties.stakes_arr_usd),
    renewalDate: date(properties.stakes_renewal_date),
  };
}

export function parseDeal(record: unknown): HubspotDeal {
  const row = obj(record);
  const properties = obj(row.properties);
  const company = list(obj(obj(row.associations).companies).results)[0];
  const issueKeys = str(properties.jira_issue_keys)
    .split(';')
    .map((key) => key.trim())
    .filter(isIssueKey);
  return {
    id: str(properties.stakes_external_id) || str(row.id),
    companyHubspotId: company ? str(company.id) || null : null,
    name: str(properties.dealname),
    amountUsd: number(properties.amount),
    stage: str(properties.stakes_stage) || str(properties.dealstage),
    probability: Math.min(1, number(properties.stakes_probability)),
    closeDate: date(properties.closedate),
    issueKeys: [...new Set(issueKeys)],
  };
}

export function makeHubspotClient(http: Fetch = fetch): HubspotClient {
  const request = async (url: string, token: string) => {
    const response = await http(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new HubspotError('HUBSPOT_AUTH_FAILED');
      }
      if (response.status === 429) throw new HubspotError('HUBSPOT_RATE_LIMITED');
      throw new HubspotError('HUBSPOT_UNAVAILABLE');
    }
    return response.json();
  };

  const pages = async (path: string, token: string, properties: string[]): Promise<Obj[]> => {
    const output: Obj[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({
        limit: '100',
        archived: 'false',
        properties: properties.join(','),
      });
      if (path.includes('/deals')) query.set('associations', 'companies');
      if (after) query.set('after', after);
      const body = obj(await request(`https://api.hubapi.com${path}?${query}`, token));
      output.push(...list(body.results));
      after = str(obj(obj(body.paging).next).after) || undefined;
    } while (after);
    return output;
  };

  return {
    async test(token) {
      await request('https://api.hubapi.com/account-info/v3/details', token);
    },
    async listCompanies(token) {
      return (await pages('/crm/v3/objects/companies', token, COMPANY_PROPERTIES)).map(
        parseCompany,
      );
    },
    async listDeals(token) {
      return (await pages('/crm/v3/objects/deals', token, DEAL_PROPERTIES)).map(parseDeal);
    },
  };
}
