import { fetch } from '@forge/api';

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

export interface HubspotClient {
  test(token: string): Promise<void>;
}

export function makeHubspotClient(http: Fetch = fetch): HubspotClient {
  return {
    async test(token) {
      const response = await http('https://api.hubapi.com/account-info/v3/details', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new HubspotError(
          response.status === 401 || response.status === 403
            ? 'HUBSPOT_AUTH_FAILED'
            : 'HUBSPOT_UNAVAILABLE',
        );
      }
    },
  };
}
