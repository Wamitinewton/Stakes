import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  makeSyncAdapters: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: { asUser: vi.fn(), asApp: vi.fn() },
  fetch: vi.fn(),
  route: vi.fn(),
}));
vi.mock('@forge/kvs', () => ({ kvs: {} }));
vi.mock('../src/adapters/index.js', () => ({ makeSyncAdapters: mocks.makeSyncAdapters }));
vi.mock('../src/services/sync.js', () => ({ syncNow: mocks.syncNow }));

const { handler } = await import('../src/resolvers/index.js');

describe('syncNow resolver', () => {
  it('invokes the sync service with adapter dependencies', async () => {
    const adapterDeps = {
      store: {},
      hubspot: {},
      connector: {},
      jira: {},
      clock: () => new Date(),
    };
    mocks.makeSyncAdapters.mockReturnValue(adapterDeps);
    mocks.syncNow.mockResolvedValue({ ok: true, data: { synced: true } });

    const result = await handler({
      call: { functionKey: 'syncNow', payload: {} },
      context: {},
    } as never);

    expect(mocks.makeSyncAdapters).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).toHaveBeenCalledWith(adapterDeps);
    expect(result).toEqual({ ok: true, data: { synced: true } });
  });
});
