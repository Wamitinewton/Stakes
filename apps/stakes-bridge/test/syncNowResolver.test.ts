import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  makeSyncAdapters: vi.fn(),
  makeJiraAdmin: vi.fn(),
  isAdmin: vi.fn(),
  syncNow: vi.fn(),
  getStatus: vi.fn(),
  saveHubspotToken: vi.fn(),
  saveSlackConfig: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: { asUser: vi.fn(), asApp: vi.fn() },
  fetch: vi.fn(),
  route: vi.fn(),
}));
vi.mock('@forge/kvs', () => ({ kvs: {} }));
vi.mock('../src/adapters/index.js', () => ({ makeSyncAdapters: mocks.makeSyncAdapters }));
vi.mock('../src/adapters/jira.js', () => ({ makeJiraAdmin: mocks.makeJiraAdmin }));
vi.mock('../src/services/sync.js', () => ({ syncNow: mocks.syncNow }));
vi.mock('../src/services/settings.js', () => ({
  getStatus: mocks.getStatus,
  saveHubspotToken: mocks.saveHubspotToken,
  saveSlackConfig: mocks.saveSlackConfig,
}));
mocks.makeJiraAdmin.mockReturnValue({ isAdmin: mocks.isAdmin });

const { handler } = await import('../src/resolvers/index.js');

async function invoke(functionKey: string, payload: Record<string, unknown> = {}) {
  return handler({ call: { functionKey, payload }, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin.mockResolvedValue(true);
});

describe('bridge resolver authorization', () => {
  it.each(['getStatus', 'saveHubspotToken', 'saveSlackConfig', 'syncNow'])(
    'rejects non-admins before %s does any work',
    async (functionKey) => {
      mocks.isAdmin.mockResolvedValue(false);

      expect(
        await invoke(functionKey, {
          token: 'secret',
          channel: '#releases',
          confirmed: true,
        }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_ADMIN' } });
      expect(mocks.getStatus).not.toHaveBeenCalled();
      expect(mocks.saveHubspotToken).not.toHaveBeenCalled();
      expect(mocks.saveSlackConfig).not.toHaveBeenCalled();
      expect(mocks.syncNow).not.toHaveBeenCalled();
      expect(mocks.makeSyncAdapters).not.toHaveBeenCalled();
    },
  );

  it.each(['saveHubspotToken', 'saveSlackConfig', 'syncNow'])(
    'requires confirmation for %s',
    async (functionKey) => {
      expect(await invoke(functionKey, { token: 'secret', channel: '#releases' })).toMatchObject({
        ok: false,
        error: { code: 'CONFIRMATION_REQUIRED' },
      });
      expect(mocks.saveHubspotToken).not.toHaveBeenCalled();
      expect(mocks.saveSlackConfig).not.toHaveBeenCalled();
      expect(mocks.syncNow).not.toHaveBeenCalled();
      expect(mocks.makeSyncAdapters).not.toHaveBeenCalled();
    },
  );

  it('returns status only after the admin check', async () => {
    mocks.getStatus.mockResolvedValue({ hubspotConfigured: false });

    expect(await invoke('getStatus')).toEqual({
      ok: true,
      data: { hubspotConfigured: false },
    });
    expect(mocks.isAdmin).toHaveBeenCalledTimes(1);
  });

  it('saves confirmed HubSpot and Slack settings', async () => {
    mocks.saveHubspotToken.mockResolvedValue({ ok: true, data: {} });
    mocks.saveSlackConfig.mockResolvedValue({ ok: true, data: {} });

    expect(await invoke('saveHubspotToken', { token: 'hubspot', confirmed: true })).toMatchObject({
      ok: true,
    });
    expect(mocks.saveHubspotToken).toHaveBeenCalledWith(expect.anything(), 'hubspot');
    expect(
      await invoke('saveSlackConfig', {
        token: 'slack',
        channel: '#releases',
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    expect(mocks.saveSlackConfig).toHaveBeenCalledWith(expect.anything(), {
      token: 'slack',
      channel: '#releases',
    });
  });
});

describe('syncNow resolver', () => {
  it('invokes the sync service with adapter dependencies after confirmation', async () => {
    const adapterDeps = {
      store: {},
      hubspot: {},
      connector: {},
      jira: {},
      clock: () => new Date(),
    };
    mocks.makeSyncAdapters.mockReturnValue(adapterDeps);
    mocks.syncNow.mockResolvedValue({ ok: true, data: { synced: true } });

    const result = await invoke('syncNow', { confirmed: true });

    expect(mocks.makeSyncAdapters).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).toHaveBeenCalledWith(adapterDeps);
    expect(result).toEqual({ ok: true, data: { synced: true } });
  });
});
