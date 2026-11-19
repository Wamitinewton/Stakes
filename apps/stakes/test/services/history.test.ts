import { describe, expect, it, vi } from 'vitest';
import { addDays, isoDay } from '../../src/core/dates.js';
import { getHistory } from '../../src/services/history.js';
import { nightlyMaintenance } from '../../src/services/maintenance.js';
import {
  makeAuditStore,
  makeLlmStore,
  makeShipNoticeStore,
  makeHistoryStore,
} from '../../src/adapters/storage.js';
import { fakeKvs } from '../fakes/kvs.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));

const NOW = new Date('2026-11-20T10:00:00.000Z');
const point = (day: string, score: number, badges: Array<'stakes-jump'> = []) => ({
  issueKey: 'PAY-118',
  projectKey: 'PAY',
  day,
  score,
  badges,
  source: 'demo' as const,
});

describe('getHistory', () => {
  it('returns the last point for each of the latest 30 days and the current jump', async () => {
    const history = makeHistoryStore(fakeKvs().kvs);
    await history.recordMany(
      Array.from({ length: 40 }, (_, i) => point(isoDay(addDays(NOW, i - 40)), i + 1)),
    );
    await history.record(point('2026-11-20', 70));
    await history.record(point('2026-11-20', 72, ['stakes-jump']));

    const result = await getHistory(
      { history, clock: () => NOW },
      { issueKey: 'PAY-118', days: 30 },
    );

    expect(result.points).toHaveLength(30);
    expect(result.points[0]).toEqual({ date: '2026-10-22', score: 12 });
    expect(result.points.at(-1)).toEqual({ date: '2026-11-20', score: 72 });
    expect(result.jump).toBe(true);
  });

  it('honours a shorter window and reports no jump for empty history', async () => {
    const history = makeHistoryStore(fakeKvs().kvs);
    await history.recordMany([point('2026-11-13', 45), point('2026-11-14', 50)]);
    const deps = { history, clock: () => NOW };

    expect((await getHistory(deps, { issueKey: 'PAY-118', days: 7 })).points).toEqual([
      { date: '2026-11-14', score: 50 },
    ]);
    expect(await getHistory(deps, { issueKey: 'PAY-999', days: 30 })).toEqual({
      points: [],
      jump: false,
    });
  });
});

describe('nightlyMaintenance', () => {
  it('purges history and audit rows beyond their retention boundaries', async () => {
    const store = fakeKvs();
    const history = makeHistoryStore(store.kvs);
    await history.recordMany([
      point('2026-10-20', 40),
      point('2026-10-21', 41),
      point('2026-11-20', 72),
    ]);
    await store.kvs.entity('audit').set('old', { at: '2026-05-23T23:59:59.999Z' });
    await store.kvs.entity('audit').set('boundary', { at: '2026-05-24T10:00:00.000Z' });
    await store.kvs.entity('audit').set('recent', { at: '2026-11-20T09:00:00.000Z' });

    const purged = await nightlyMaintenance({
      history,
      audit: makeAuditStore(store.kvs),
      llm: makeLlmStore(store.kvs),
      notices: makeShipNoticeStore(store.kvs),
      clock: () => NOW,
    });

    expect(purged).toEqual({ history: 1, audit: 1, llmCache: 0, shipNotices: 0 });
    expect((await history.since('PAY-118', '2026-01-01')).map((p) => p.day)).toEqual([
      '2026-10-21',
      '2026-11-20',
    ]);
    expect([...store.rows('audit').keys()].sort()).toEqual(['boundary', 'recent']);
  });
});
