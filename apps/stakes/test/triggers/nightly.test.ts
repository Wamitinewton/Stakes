import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const purge = vi.hoisted(() => ({
  history: vi.fn(),
  audit: vi.fn(),
  llmCache: vi.fn(),
  llmDay: vi.fn(),
}));

vi.mock('../../src/adapters/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/storage.js')>();
  return {
    ...actual,
    makeHistoryStore: () => ({ purgeBefore: purge.history }),
    makeAuditStore: () => ({ purgeBefore: purge.audit }),
    makeLlmStore: () => ({ purgeCacheUnusedBefore: purge.llmCache, deleteDay: purge.llmDay }),
  };
});

import { nightly } from '../../src/triggers/index.js';

describe('nightly trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
    purge.history.mockResolvedValue(2);
    purge.audit.mockResolvedValue(1);
    purge.llmCache.mockResolvedValue(4);
    purge.llmDay.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs storage-only retention with history and audit cutoffs', async () => {
    await nightly();

    expect(purge.history).toHaveBeenCalledWith('2026-10-21');
    expect(purge.audit).toHaveBeenCalledWith('2026-05-24T10:00:00.000Z');
    expect(purge.llmCache).toHaveBeenCalledWith('2026-10-21T10:00:00.000Z');
    expect(purge.llmDay.mock.calls.map((c) => c[0])).toEqual([
      '2026-10-20',
      '2026-10-19',
      '2026-10-18',
      '2026-10-17',
      '2026-10-16',
      '2026-10-15',
      '2026-10-14',
    ]);
    expect(console.log).toHaveBeenCalledWith('nightly maintenance complete', {
      historyPurged: 2,
      auditPurged: 1,
      llmCachePurged: 4,
    });
  });
});
