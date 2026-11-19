import { describe, expect, it, vi } from 'vitest';
import {
  HUBSPOT_TOKEN_KEY,
  SLACK_CHANNEL_KEY,
  SLACK_TOKEN_KEY,
  type BridgeStore,
} from '../src/adapters/storage.js';
import {
  getStatus,
  maskSecret,
  saveHubspotToken,
  saveSlackConfig,
  type SettingsDeps,
} from '../src/services/settings.js';

function fixture() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const store: BridgeStore = {
    getSecret: async (key) => secrets.get(key),
    setSecret: async (key, value) => void secrets.set(key, value),
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
  return { store, values, secrets };
}

function deps(overrides: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    store: fixture().store,
    hubspot: { test: vi.fn(async () => {}) },
    slack: { test: vi.fn(async () => {}) },
    ...overrides,
  };
}

describe('bridge settings', () => {
  it('tests and stores a HubSpot token once, returning only its mask', async () => {
    const { store, secrets } = fixture();
    const test = vi.fn(async () => {});
    const result = await saveHubspotToken(
      deps({ store, hubspot: { test } }),
      'hubspot-test-value-1a2b',
    );

    expect(test).toHaveBeenCalledTimes(1);
    expect(secrets.get(HUBSPOT_TOKEN_KEY)).toBe('hubspot-test-value-1a2b');
    expect(result).toMatchObject({
      ok: true,
      data: { hubspotConfigured: true, hubspotToken: 'configured · ••••1a2b' },
    });
    expect(JSON.stringify(result)).not.toContain('hubspot-test-value');
  });

  it('does not store a token that fails its test', async () => {
    const { store, secrets } = fixture();
    const result = await saveHubspotToken(
      deps({ store, hubspot: { test: vi.fn(async () => Promise.reject(new Error('no'))) } }),
      'bad-value',
    );

    expect(result.ok).toBe(false);
    expect(secrets.size).toBe(0);
  });

  it('tests Slack once and stores the channel separately from the secret', async () => {
    const { store, values, secrets } = fixture();
    const test = vi.fn(async () => {});
    const result = await saveSlackConfig(deps({ store, slack: { test } }), {
      token: 'slack-test-value-9z8y',
      channel: '#releases',
    });

    expect(test).toHaveBeenCalledTimes(1);
    expect(secrets.get(SLACK_TOKEN_KEY)).toBe('slack-test-value-9z8y');
    expect(values.get(SLACK_CHANNEL_KEY)).toBe('#releases');
    expect(values.has(SLACK_TOKEN_KEY)).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      data: {
        slackConfigured: true,
        slackToken: 'configured · ••••9z8y',
        slackChannel: '#releases',
      },
    });
    expect(JSON.stringify(result)).not.toContain('slack-test-value');
  });

  it('returns only masked status even after both secrets are saved', async () => {
    const { store, secrets } = fixture();
    secrets.set(HUBSPOT_TOKEN_KEY, 'test-token-aaaa');
    secrets.set(SLACK_TOKEN_KEY, 'test-token-bbbb');

    const status = await getStatus({ store });
    const serialized = JSON.stringify(status);
    expect(status.hubspotToken).toBe(maskSecret('test-token-aaaa'));
    expect(status.slackToken).toBe(maskSecret('test-token-bbbb'));
    expect(serialized).not.toContain('test-token-aaaa');
    expect(serialized).not.toContain('test-token-bbbb');
  });
});
