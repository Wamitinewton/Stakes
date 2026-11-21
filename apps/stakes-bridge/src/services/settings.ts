import type { HubspotClient } from '../adapters/hubspot.js';
import type { SlackClient } from '../adapters/slack.js';
import {
  HUBSPOT_TOKEN_KEY,
  SLACK_CHANNEL_KEY,
  SLACK_TOKEN_KEY,
  slackChannel,
  syncStatus,
  type BridgeStore,
} from '../adapters/storage.js';
import { err, ok, type Result } from '../core/result.js';

export interface BridgeStatus {
  hubspotConfigured: boolean;
  hubspotToken: string | null;
  slackConfigured: boolean;
  slackToken: string | null;
  slackChannel: string | null;
  lastSync: string | null;
  counts: { customers: number; deals: number; issues: number };
  lastErrorCode: string | null;
  runsOnAtlassian: false;
}

export interface SettingsDeps {
  store: BridgeStore;
  hubspot: Pick<HubspotClient, 'test'>;
  slack: Pick<SlackClient, 'test'>;
}

export function maskSecret(secret: string): string {
  return `configured · ••••${secret.slice(-4)}`;
}

export async function getStatus(deps: Pick<SettingsDeps, 'store'>): Promise<BridgeStatus> {
  const [hubspotToken, slackToken, channel, sync] = await Promise.all([
    deps.store.getSecret(HUBSPOT_TOKEN_KEY),
    deps.store.getSecret(SLACK_TOKEN_KEY),
    slackChannel(deps.store),
    syncStatus(deps.store),
  ]);
  return {
    hubspotConfigured: Boolean(hubspotToken),
    hubspotToken: hubspotToken ? maskSecret(hubspotToken) : null,
    slackConfigured: Boolean(slackToken),
    slackToken: slackToken ? maskSecret(slackToken) : null,
    slackChannel: channel,
    lastSync: sync.lastSync,
    counts: sync.counts,
    lastErrorCode: sync.lastErrorCode,
    runsOnAtlassian: false,
  };
}

export async function saveHubspotToken(
  deps: SettingsDeps,
  token: string,
): Promise<Result<BridgeStatus>> {
  const candidate = token.trim();
  if (!candidate) return err('INVALID_INPUT', 'Enter a HubSpot private-app token.');
  try {
    await deps.hubspot.test(candidate);
  } catch {
    return err('HUBSPOT_AUTH_FAILED', 'HubSpot rejected the token or could not be reached.');
  }
  await deps.store.setSecret(HUBSPOT_TOKEN_KEY, candidate);
  return ok(await getStatus(deps));
}

export async function saveSlackConfig(
  deps: SettingsDeps,
  input: { token: string; channel: string },
): Promise<Result<BridgeStatus>> {
  const token = input.token.trim();
  const channel = input.channel.trim();
  if (!token || !channel) return err('INVALID_INPUT', 'Enter a Slack bot token and channel.');
  try {
    await deps.slack.test(token);
  } catch {
    return err('SLACK_AUTH_FAILED', 'Slack rejected the token or could not be reached.');
  }
  await deps.store.setSecret(SLACK_TOKEN_KEY, token);
  await deps.store.set(SLACK_CHANNEL_KEY, channel);
  return ok(await getStatus(deps));
}
