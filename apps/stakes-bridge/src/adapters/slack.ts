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
  postMessage(token: string, channel: string, internalNote: string): Promise<void>;
  lookupByEmail(token: string, email: string): Promise<string | null>;
  postDirectMessage(token: string, slackUserId: string, internalNote: string): Promise<void>;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {});

function slackError(body: Obj): SlackError {
  const code = typeof body.error === 'string' ? body.error : 'unknown_error';
  if (code === 'channel_not_found') return new SlackError('SLACK_CHANNEL_NOT_FOUND');
  if (code === 'users_not_found') return new SlackError('SLACK_USER_NOT_FOUND');
  if (code === 'ratelimited' || code === 'rate_limited') {
    return new SlackError('SLACK_RATE_LIMITED');
  }
  return new SlackError('SLACK_REQUEST_FAILED');
}

export function makeSlackClient(http: Fetch = fetch): SlackClient {
  const request = async (
    path: string,
    token: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<Obj> => {
    const response = await http(`https://slack.com/api/${path}`, {
      method: options.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 429) throw new SlackError('SLACK_RATE_LIMITED');
    if (!response.ok) throw new SlackError('SLACK_UNAVAILABLE');
    const body = obj(await response.json());
    if (body.ok !== true) throw slackError(body);
    return body;
  };

  return {
    async test(token) {
      await request('auth.test', token).catch((error: unknown) => {
        if (error instanceof SlackError && error.code === 'SLACK_REQUEST_FAILED') {
          throw new SlackError('SLACK_AUTH_FAILED');
        }
        throw error;
      });
    },
    async postMessage(token, channel, internalNote) {
      await request('chat.postMessage', token, { body: { channel, text: internalNote } });
    },
    async lookupByEmail(token, email) {
      const query = new URLSearchParams({ email });
      try {
        const body = await request(`users.lookupByEmail?${query}`, token, { method: 'GET' });
        const user = obj(body.user);
        return typeof user.id === 'string' && user.id ? user.id : null;
      } catch (error) {
        if (error instanceof SlackError && error.code === 'SLACK_USER_NOT_FOUND') return null;
        throw error;
      }
    },
    async postDirectMessage(token, slackUserId, internalNote) {
      const opened = await request('conversations.open', token, { body: { users: slackUserId } });
      const channel = obj(opened.channel).id;
      if (typeof channel !== 'string' || !channel) throw new SlackError('SLACK_REQUEST_FAILED');
      await request('chat.postMessage', token, { body: { channel, text: internalNote } });
    },
  };
}
