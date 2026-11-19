import { fetch } from '@forge/api';
import type { Fetch } from './hubspot.js';

export class SlackError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SlackError';
  }
}

export interface SlackClient {
  test(token: string): Promise<void>;
}

export function makeSlackClient(http: Fetch = fetch): SlackClient {
  return {
    async test(token) {
      const response = await http('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!response.ok) throw new SlackError('SLACK_UNAVAILABLE');
      const body = (await response.json()) as { ok?: boolean };
      if (body.ok !== true) throw new SlackError('SLACK_AUTH_FAILED');
    },
  };
}
