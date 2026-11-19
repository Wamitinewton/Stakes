import { describe, expect, it } from 'vitest';
import ok from './fixtures/slack/ok.json';
import usersNotFound from './fixtures/slack/users_not_found.json';
import channelNotFound from './fixtures/slack/channel_not_found.json';
import rateLimited from './fixtures/slack/rate-limited.json';
import { makeSlackClient, type SlackClient } from '../src/adapters/slack.js';
import type { Fetch } from '../src/adapters/hubspot.js';

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const clientWith = (body: unknown, status = 200): SlackClient =>
  makeSlackClient(async () => respond(body, status));

describe('Slack fixtures', () => {
  it('posts only the supplied channel and internal note', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const http: Fetch = async (_url, init) => {
      requestBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return respond(ok);
    };
    await makeSlackClient(http).postMessage('test-token', 'C123', 'Internal note');
    expect(requestBody).toEqual({ channel: 'C123', text: 'Internal note' });
  });

  it('returns null for users_not_found', async () => {
    const client = clientWith(usersNotFound);
    await expect(client.lookupByEmail('test-token', 'owner@example.com')).resolves.toBeNull();
  });

  it('classifies channel_not_found', async () => {
    const client = clientWith(channelNotFound);
    await expect(client.postMessage('test-token', 'C123', 'note')).rejects.toMatchObject({
      code: 'SLACK_CHANNEL_NOT_FOUND',
    });
  });

  it('classifies rate limits from Slack 200 responses and HTTP 429', async () => {
    await expect(
      clientWith(rateLimited).postMessage('test-token', 'C123', 'note'),
    ).rejects.toMatchObject({ code: 'SLACK_RATE_LIMITED' });
    await expect(
      clientWith(rateLimited, 429).postMessage('test-token', 'C123', 'note'),
    ).rejects.toMatchObject({ code: 'SLACK_RATE_LIMITED' });
  });

  it('opens a DM and posts the same internal note', async () => {
    const bodies: Record<string, unknown>[] = [];
    const http: Fetch = async (_url, init) => {
      bodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      return respond(ok);
    };
    await makeSlackClient(http).postDirectMessage('test-token', 'U123', 'Internal note');
    expect(bodies).toEqual([{ users: 'U123' }, { channel: 'D123', text: 'Internal note' }]);
  });
});
