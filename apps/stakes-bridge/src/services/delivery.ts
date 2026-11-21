import type { IssueKey } from '@stakes/contracts';
import type { PendingShipNotice } from '../adapters/jira.js';
import { SlackError, type SlackClient } from '../adapters/slack.js';
import { SLACK_CHANNEL_KEY, SLACK_TOKEN_KEY, type BridgeStore } from '../adapters/storage.js';
import { err, ok, type Result } from '../core/result.js';

export interface DeliveryDeps {
  store: BridgeStore;
  jira: {
    pendingShipNotices(): Promise<PendingShipNotice[]>;
    ownerEmail(accountId: string): Promise<string | null>;
    writeShipNotice(issueKey: IssueKey, value: PendingShipNotice['notice']): Promise<void>;
  };
  slack: Pick<SlackClient, 'postMessage' | 'lookupByEmail' | 'postDirectMessage'>;
  clock: () => Date;
}

export interface DeliveryRecord {
  channelPosted: boolean;
  completedOwnerIds: string[];
}

export interface DeliverySummary {
  found: number;
  delivered: number;
  failed: number;
  skippedOwners: number;
}

export function deliveryKey(issueKey: string, sentAt: string): string {
  return `bridge:delivery:${issueKey}:${sentAt}`;
}

export async function deliverNotices(deps: DeliveryDeps): Promise<Result<DeliverySummary>> {
  const [token, channel] = await Promise.all([
    deps.store.getSecret(SLACK_TOKEN_KEY),
    deps.store.get<string>(SLACK_CHANNEL_KEY),
  ]);
  if (!token || !channel) return err('SLACK_NOT_CONFIGURED', 'Save the Slack configuration first.');

  const notices = await deps.jira.pendingShipNotices();
  const summary: DeliverySummary = {
    found: notices.length,
    delivered: 0,
    failed: 0,
    skippedOwners: 0,
  };

  for (const { issueKey, notice } of notices) {
    const key = deliveryKey(issueKey, notice.sentAt);
    try {
      let record = (await deps.store.get<DeliveryRecord>(key)) ?? {
        channelPosted: false,
        completedOwnerIds: [],
      };
      if (!record.channelPosted) {
        await deps.slack.postMessage(token, channel, notice.internalNote);
        record = { ...record, channelPosted: true };
        await deps.store.set(key, record);
      }

      for (const ownerId of [...new Set(notice.ownerAccountIds)]) {
        if (record.completedOwnerIds.includes(ownerId)) continue;
        const email = await deps.jira.ownerEmail(ownerId);
        const slackUserId = email ? await deps.slack.lookupByEmail(token, email) : null;
        if (slackUserId) {
          await deps.slack.postDirectMessage(token, slackUserId, notice.internalNote);
        } else {
          summary.skippedOwners++;
        }
        record = {
          ...record,
          completedOwnerIds: [...record.completedOwnerIds, ownerId],
        };
        await deps.store.set(key, record);
      }

      await deps.jira.writeShipNotice(issueKey, {
        ...notice,
        deliveredAt: deps.clock().toISOString(),
      });
      summary.delivered++;
    } catch (error) {
      summary.failed++;
      console.warn('Slack ship delivery failed', {
        issueKey,
        code: error instanceof SlackError ? error.code : 'DELIVERY_WRITE_FAILED',
      });
    }
  }
  return ok(summary);
}
