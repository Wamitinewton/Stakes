import { describe, expect, it } from 'vitest';
import { ShipNoticeProperty, type IssueKey } from '@stakes/contracts';
import { SENT_UNDELIVERED_JQL } from '../src/adapters/jira.js';
import { SlackError } from '../src/adapters/slack.js';
import { SLACK_CHANNEL_KEY, SLACK_TOKEN_KEY, type BridgeStore } from '../src/adapters/storage.js';
import {
  deliverNotices,
  deliveryKey,
  type DeliveryDeps,
  type DeliveryRecord,
} from '../src/services/delivery.js';

const notice = ShipNoticeProperty.parse({
  status: 'sent',
  internalNote: 'Internal release note only',
  ownerAccountIds: ['owner-1'],
  sentAt: '2026-11-19T11:55:00.000Z',
});

function harness(options: { failFirstPropertyWrite?: boolean; slackUserId?: string | null } = {}) {
  const values = new Map<string, unknown>([[SLACK_CHANNEL_KEY, 'C123']]);
  const secrets = new Map<string, string>([[SLACK_TOKEN_KEY, 'stored-secret']]);
  const store: BridgeStore = {
    getSecret: async (key) => secrets.get(key),
    setSecret: async (key, value) => void secrets.set(key, value),
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
  const events: Array<{ type: string; text?: string; email?: string; value?: unknown }> = [];
  let propertyAttempts = 0;
  let dmAttempts = 0;
  let failNextDm = false;
  const deps: DeliveryDeps = {
    store,
    jira: {
      pendingShipNotices: async () => [{ issueKey: 'PAY-142' as IssueKey, notice }],
      ownerEmail: async () => 'owner@example.com',
      writeShipNotice: async (_issueKey, value) => {
        propertyAttempts++;
        if (options.failFirstPropertyWrite && propertyAttempts === 1) {
          throw new Error('property write failed');
        }
        events.push({ type: 'property', value });
      },
    },
    slack: {
      postMessage: async (_token, _channel, internalNote) => {
        events.push({ type: 'channel', text: internalNote });
      },
      lookupByEmail: async (_token, email) => {
        events.push({ type: 'lookup', email });
        return options.slackUserId === undefined ? 'U123' : options.slackUserId;
      },
      postDirectMessage: async (_token, _userId, internalNote) => {
        dmAttempts++;
        if (failNextDm) {
          failNextDm = false;
          throw new SlackError('SLACK_RATE_LIMITED');
        }
        events.push({ type: 'dm', text: internalNote });
      },
    },
    clock: () => new Date('2026-11-19T12:00:00.000Z'),
  };
  return {
    deps,
    values,
    events,
    failNextDm: () => {
      failNextDm = true;
    },
    counts: () => ({ propertyAttempts, dmAttempts }),
  };
}

describe('Slack ship delivery', () => {
  it('uses the exact sent-and-undelivered JQL', () => {
    expect(SENT_UNDELIVERED_JQL).toBe(
      'issue.property[stakes.shipNotice].status = sent AND issue.property[stakes.shipNotice].deliveredAt IS EMPTY',
    );
  });

  it('posts the channel and owner DM before writing deliveredAt', async () => {
    const h = harness();
    const result = await deliverNotices(h.deps);

    expect(result).toMatchObject({
      ok: true,
      data: { found: 1, delivered: 1, failed: 0, skippedOwners: 0 },
    });
    expect(h.events.map((event) => event.type)).toEqual(['channel', 'lookup', 'dm', 'property']);
    expect(h.events.filter((event) => event.text)).toEqual([
      { type: 'channel', text: notice.internalNote },
      { type: 'dm', text: notice.internalNote },
    ]);
    expect(h.events[1]?.email).toBe('owner@example.com');
    expect(h.events[3]?.value).toMatchObject({
      deliveredAt: '2026-11-19T12:00:00.000Z',
    });
  });

  it('does not repost when deliveredAt write fails and the job runs again', async () => {
    const h = harness({ failFirstPropertyWrite: true });

    const first = await deliverNotices(h.deps);
    const second = await deliverNotices(h.deps);

    expect(first).toMatchObject({ ok: true, data: { delivered: 0, failed: 1 } });
    expect(second).toMatchObject({ ok: true, data: { delivered: 1, failed: 0 } });
    expect(h.events.filter((event) => event.type === 'channel')).toHaveLength(1);
    expect(h.events.filter((event) => event.type === 'dm')).toHaveLength(1);
    expect(h.events.filter((event) => event.type === 'lookup')).toHaveLength(1);
    expect(h.counts().propertyAttempts).toBe(2);
  });

  it('resumes a failed DM without duplicating the channel post', async () => {
    const h = harness();
    h.failNextDm();

    const first = await deliverNotices(h.deps);
    const second = await deliverNotices(h.deps);

    expect(first).toMatchObject({ ok: true, data: { delivered: 0, failed: 1 } });
    expect(second).toMatchObject({ ok: true, data: { delivered: 1, failed: 0 } });
    expect(h.events.filter((event) => event.type === 'channel')).toHaveLength(1);
    expect(h.counts().dmAttempts).toBe(2);
  });

  it('skips users_not_found and still completes the successful channel delivery', async () => {
    const h = harness({ slackUserId: null });
    const result = await deliverNotices(h.deps);

    expect(result).toMatchObject({
      ok: true,
      data: { delivered: 1, failed: 0, skippedOwners: 1 },
    });
    expect(h.events.map((event) => event.type)).toEqual(['channel', 'lookup', 'property']);
    const record = h.values.get(deliveryKey('PAY-142', notice.sentAt)) as DeliveryRecord;
    expect(record.completedOwnerIds).toEqual(['owner-1']);
  });
});
