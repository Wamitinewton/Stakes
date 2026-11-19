import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn());
const makeAppAdapters = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({
  settings: { name: 'settings' },
  snapshots: { name: 'snapshots' },
  notices: { name: 'notices' },
  digest: { name: 'digest' },
  confluence: { name: 'confluence' },
  graph: { name: 'graph' },
}));

vi.mock('../../src/services/digest.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/digest.js')>()),
  weeklyDigest: run,
}));
vi.mock('../../src/adapters/index.js', () => ({ makeAppAdapters }));
vi.mock('../../src/resolvers/textWriter.js', () => ({ makeWriter: () => ({ write: vi.fn() }) }));
vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));

const { weeklyDigest } = await import('../../src/triggers/index.js');

describe('weekly digest trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    makeAppAdapters.mockReturnValue(app);
    run.mockResolvedValue({
      at: '2026-11-16T06:00:00.000Z',
      status: 'completed',
      reason: null,
      created: 1,
      updated: 0,
      failed: 0,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each(['2026-11-15T10:00:00.000Z', '2026-11-16T05:59:59.000Z', '2026-11-17T10:00:00.000Z'])(
    'does not run at %s',
    async (at) => {
      vi.setSystemTime(new Date(at));
      await weeklyDigest();
      expect(makeAppAdapters).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('runs asApp after Monday 06:00 UTC and passes no graph to the service', async () => {
    vi.setSystemTime(new Date('2026-11-16T06:00:00.000Z'));
    await weeklyDigest();

    expect(makeAppAdapters).toHaveBeenCalledWith({ siteUrl: '', cloudId: '' });
    expect(run).toHaveBeenCalledOnce();
    const deps = run.mock.calls[0]![0] as Record<string, unknown>;
    expect(deps).toMatchObject({
      settings: app.settings,
      snapshots: app.snapshots,
      notices: app.notices,
      digest: app.digest,
      confluence: app.confluence,
    });
    expect(deps).not.toHaveProperty('graph');
  });
});
