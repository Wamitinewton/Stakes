import { describe, expect, it, vi } from 'vitest';
import {
  makeHistoryStore,
  makeMirrorStore,
  makePercentileStore,
  makeSeedStore,
  makeSettingsStore,
  makeSnapshotStore,
} from '../../src/adapters/storage.js';
import { DEMO_DATA } from '../../src/services/demoData.js';
import { getStakes } from '../../src/services/getStakes.js';
import { removeDemo, seedDemo, type SeedDeps, type SeedRecord } from '../../src/services/seed.js';
import { fakeKvs } from '../fakes/kvs.js';
import { fakeSite } from '../fakes/site.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/api', () => ({ default: {}, route: vi.fn() }));
vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Seeded well after the anchor date, to prove the shifted story scores the same.
const SEEDED_AT = new Date('2027-01-08T09:30:00.000Z');
const input = { softwareProjectKey: 'PAY', serviceProjectKey: 'HELP', accountId: 'admin-1' };

function setup(
  siteOpts: Parameters<typeof fakeSite>[0] = {},
  opts: { connected?: boolean; budgetMs?: number } = {},
) {
  const store = fakeKvs();
  const site = fakeSite(siteOpts);
  let t = SEEDED_AT.getTime();
  const connector = {
    pushCustomers: vi.fn(async (c: unknown[]) => ({ accepted: c.length, rejected: [] })),
    pushDeals: vi.fn(async (d: unknown[]) => ({ accepted: d.length, rejected: [] })),
    deleteObjects: vi.fn(async () => ({ failed: 0 })),
  };
  const scoreField = { set: vi.fn(async () => {}) };
  const deps: SeedDeps = {
    writer: site.writer,
    mirror: makeMirrorStore(store.kvs),
    history: makeHistoryStore(store.kvs),
    percentiles: makePercentileStore(store.kvs),
    snapshots: makeSnapshotStore(store.kvs),
    scoreField,
    connector,
    connections: { get: async () => (opts.connected ? 'conn-1' : null) },
    seed: makeSeedStore<SeedRecord>(store.kvs),
    data: DEMO_DATA,
    siteUrl: 'https://example.atlassian.net',
    // Every clock read moves time on a little, so the budget logic is exercised.
    clock: () => new Date((t += 5)),
    budgetMs: opts.budgetMs ?? 60_000,
  };
  return { deps, site, store, connector, scoreField };
}

async function seedToEnd(deps: SeedDeps) {
  let calls = 0;
  let result = await seedDemo(deps, input);
  while (result.ok && result.data.state === 'loading' && calls < 500) {
    calls++;
    result = await seedDemo(deps, input);
  }
  return { result, calls };
}

describe('seedDemo on a fresh project', () => {
  it('creates the story keys exactly, then deletes the placeholders', async () => {
    const { deps, site } = setup();
    const { result } = await seedToEnd(deps);
    expect(result).toMatchObject({ ok: true, data: { state: 'loaded', keyMap: {} } });
    const pay = [...site.issues.keys()].filter((k) => k.startsWith('PAY-')).sort();
    expect(pay).toEqual(DEMO_DATA.issues.map((i) => i.key).sort());
    const help = [...site.issues.keys()].filter((k) => k.startsWith('HELP-'));
    expect(help).toHaveLength(15);
    expect(help).toContain('HELP-1');
    expect([...site.issues.values()].every((i) => i.labels.includes('stakes-demo'))).toBe(true);
  });

  it('builds the whole Orbit Pay story', async () => {
    const { deps, site, store, scoreField } = setup();
    await seedToEnd(deps);
    expect(scoreField.set).toHaveBeenCalledTimes(DEMO_DATA.issues.length);
    expect(scoreField.set).toHaveBeenCalledWith('PAY-142', 88);
    expect(scoreField.set).toHaveBeenCalledWith('PAY-118', 71);
    expect(site.issues.get('PAY-142')).toMatchObject({
      priority: 'Low',
      summary: 'CSV export times out above 10k rows',
    });
    expect(site.issues.get('PAY-150')!.priority).toBe('Highest');
    expect([...site.versions.values()]).toEqual(['2026.12']);
    expect([...site.issues.values()].filter((i) => i.fixVersionIds.length > 0)).toHaveLength(5);
    expect([...site.sprints.values()]).toEqual([
      { name: 'PAY Sprint 23', active: true },
      { name: 'PAY Sprint 24', active: false },
    ]);
    expect(site.links.filter(([, out]) => out === 'PAY-142')).toHaveLength(7);
    expect([...site.issues.values()].filter((i) => i.labels.includes('escalation'))).toHaveLength(
      3,
    );
    // Request ages are stamped relative to the seed day.
    expect(site.issues.get('HELP-1')!.properties['stakes.demo']).toEqual({
      createdAt: expect.stringMatching(/^2026-12-24T09:30:00/),
      slaBreachAt: null,
    });

    const mirror = makeMirrorStore(store.kvs);
    const deals = await mirror.dealsForIssue('PAY-142');
    expect(deals.map((d) => d.id).sort()).toEqual(['DEAL-031', 'DEAL-034', 'DEAL-036']);
    // 15 Dec 2026 moved by the 49 days between the anchor and the seed day.
    expect(deals.find((d) => d.id === 'DEAL-031')).toMatchObject({
      closeDate: '2027-02-02',
      ownerAccountId: 'admin-1',
      source: 'demo',
    });
    expect(await mirror.messagesForIssue('PAY-142')).toHaveLength(6);
    expect(store.rows('customer').size).toBe(8);
    expect(store.rows('deal').size).toBe(12);
    expect(store.rows('history').size).toBe(25 * 30);
    expect(await makePercentileStore(store.kvs).get('PAY')).toMatchObject({
      R: 450000,
      S: 18,
      C: 9,
      H: 10,
      scoredCount: 25,
      seeded: true,
    });
    expect(await mirror.dealsVersion()).toBe(1);
  });

  it('works through many short calls without repeating work', async () => {
    const { deps, site } = setup({}, { budgetMs: 1 });
    const { result, calls } = await seedToEnd(deps);
    expect(result).toMatchObject({ ok: true, data: { state: 'loaded' } });
    expect(calls).toBeGreaterThan(20);
    expect([...site.issues.keys()].filter((k) => k.startsWith('PAY-'))).toHaveLength(25);
  });

  it('reports progress that only moves forward', async () => {
    const { deps } = setup({}, { budgetMs: 1 });
    const seen: number[] = [];
    let r = await seedDemo(deps, input);
    while (r.ok && r.data.state === 'loading' && seen.length < 500) {
      seen.push(r.data.done / r.data.total);
      r = await seedDemo(deps, input);
    }
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]!)).toBe(true);
    expect(r.ok && r.data.done).toBe(r.ok && r.data.total);
  });

  it('pushes customers and deals through the connector when it is connected', async () => {
    const { deps, connector } = setup({}, { connected: true });
    await seedToEnd(deps);
    expect(connector.pushCustomers.mock.calls[0]![0]).toHaveLength(8);
    expect(connector.pushDeals.mock.calls[0]![0]).toHaveLength(12);
  });

  it('returns the loaded status without doing anything when called again', async () => {
    const { deps, site } = setup();
    await seedToEnd(deps);
    const before = site.calls.creates;
    expect(await seedDemo(deps, input)).toMatchObject({ ok: true, data: { state: 'loaded' } });
    expect(site.calls.creates).toBe(before);
  });
});

describe('seedDemo on a project that already has issues', () => {
  it('uses the next free keys and maps story keys onto them everywhere', async () => {
    const { deps, site, store } = setup({ nextPay: 400, nextHelp: 50 });
    const { result } = await seedToEnd(deps);
    expect(result.ok && result.data.keyMap['PAY-142']).toMatch(/^PAY-4\d\d$/);
    const real142 = result.ok ? result.data.keyMap['PAY-142']! : '';
    expect(site.issues.get(real142)!.summary).toBe('CSV export times out above 10k rows');
    expect(site.issues.has('PAY-142')).toBe(false);
    expect(await makeMirrorStore(store.kvs).dealsForIssue(real142)).toHaveLength(3);
    expect(site.links.filter(([, out]) => out === real142)).toHaveLength(7);
    expect(site.calls.deletes).toBe(1);
  });
});

describe('seedDemo failures', () => {
  it('refuses projects of the wrong type and records why', async () => {
    const { deps } = setup();
    const result = await seedDemo(deps, { ...input, serviceProjectKey: 'OPS' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'OPS is not a service project you can see.' },
    });
    expect((await deps.seed.status()).state).toBe('failed');
  });

  it('refuses the same project twice', async () => {
    const { deps } = setup();
    expect(await seedDemo(deps, { ...input, serviceProjectKey: 'PAY' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('retries a refused story issue without its optional fields', async () => {
    let refusals = 0;
    const { deps, site } = setup({
      refuse: (i) => Boolean(i.storyPoints) && i.summary.startsWith('CSV') && refusals++ === 0,
    });
    const { result } = await seedToEnd(deps);
    // A refused create uses no issue number, so later keys shift; the key map follows.
    const key = result.ok ? (result.data.keyMap['PAY-142'] ?? 'PAY-142') : '';
    expect(site.issues.get(key)?.summary).toBe('CSV export times out above 10k rows');
    expect([...site.issues.keys()].filter((k) => k.startsWith('PAY-'))).toHaveLength(25);
  });

  it('resumes after a failed call', async () => {
    const { deps, site } = setup();
    const original = site.writer.createRequest;
    site.writer.createRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockImplementation(original);
    const first = await seedToEnd(deps);
    expect(first.result).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
    expect((await deps.seed.status()).state).toBe('failed');
    const second = await seedToEnd(deps);
    expect(second.result).toMatchObject({ ok: true, data: { state: 'loaded' } });
    expect([...site.issues.keys()].filter((k) => k.startsWith('HELP-'))).toHaveLength(15);
  });
});

describe('removeDemo', () => {
  async function removeToEnd(deps: SeedDeps) {
    let r = await removeDemo(deps);
    let calls = 0;
    while (r.ok && r.data.state === 'removing' && calls++ < 500) r = await removeDemo(deps);
    return r;
  }

  it('deletes everything the seeder created and nothing else, then seeds again', async () => {
    const { deps, site, store, connector } = setup({}, { connected: true });
    await seedToEnd(deps);
    site.issues.set('PAY-999', { ...site.issues.get('PAY-142')!, key: 'PAY-999', labels: [] });
    const csvCustomer = {
      id: 'CSV-1',
      name: 'Own',
      tier: 'smb' as const,
      arrUsd: 1,
      renewalDate: null,
      ownerAccountId: null,
      source: 'csv' as const,
    };
    await makeMirrorStore(store.kvs).upsertCustomers([csvCustomer]);

    const removed = await removeToEnd(deps);
    expect(removed).toMatchObject({
      ok: true,
      data: { state: 'not-loaded', removed: { issues: 40, customers: 8, deals: 12, history: 750 } },
    });
    expect([...site.issues.keys()]).toEqual(['PAY-999']);
    expect(site.versions.size).toBe(0);
    expect(site.sprints.size).toBe(0);
    expect(store.rows('deal').size).toBe(0);
    expect(store.rows('message').size).toBe(0);
    expect(store.rows('history').size).toBe(0);
    expect([...store.rows('customer').keys()]).toEqual(['CSV-1']);
    expect(await makePercentileStore(store.kvs).get('PAY')).toBeNull();
    expect(connector.deleteObjects).toHaveBeenCalledWith(
      'atlassian:deal',
      expect.arrayContaining(['DEAL-031']),
      'conn-1',
    );
    expect((await deps.seed.status()).state).toBe('not-loaded');

    const again = await seedToEnd(deps);
    expect(again.result).toMatchObject({ ok: true, data: { state: 'loaded' } });
  });

  it('removes in short calls too, and picks up labelled leftovers', async () => {
    const { deps, site } = setup({}, { budgetMs: 1 });
    await seedToEnd(deps);
    site.issues.set('HELP-77', { ...site.issues.get('HELP-1')!, key: 'HELP-77' });
    const r = await removeToEnd(deps);
    expect(r).toMatchObject({ ok: true, data: { state: 'not-loaded' } });
    expect(site.issues.size).toBe(0);
  });

  it('does nothing when no demo was loaded', async () => {
    const { deps } = setup();
    expect(await removeDemo(deps)).toMatchObject({
      ok: true,
      data: { state: 'not-loaded', removed: { issues: 0 } },
    });
  });

  it('will not seed while a removal is under way', async () => {
    const { deps } = setup({}, { budgetMs: 1 });
    await seedToEnd(deps);
    await removeDemo(deps);
    expect(await seedDemo(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});

describe('seeded data through getStakes', () => {
  async function seededStakes(withGoal: boolean) {
    const { deps, site, store } = setup();
    await seedToEnd(deps);
    const goal = {
      id: 'g1',
      name: 'Reduce enterprise churn',
      status: 'on-track' as const,
      url: 'https://goal',
    };
    const stakesDeps = {
      jira: site.reader,
      graph: {
        dealsForIssue: async () => ({ ok: true as const, data: [] }),
        conversationsForIssue: async () => ({ ok: true as const, data: [] }),
        goalsForIssue: async (issue: { key: string }) => ({
          ok: true as const,
          data: withGoal && issue.key === 'PAY-142' ? [goal] : [],
        }),
      },
      mirror: makeMirrorStore(store.kvs),
      snapshots: makeSnapshotStore(store.kvs),
      history: makeHistoryStore(store.kvs),
      settings: makeSettingsStore(store.kvs),
      percentiles: makePercentileStore(store.kvs),
      scoreField: deps.scoreField,
      siteUrl: 'https://example.atlassian.net',
      clock: () => SEEDED_AT,
    };
    return (key: string) => getStakes(stakesDeps, key, { refresh: true });
  }

  it('shows PAY-142 at 89, suggested Highest, silent fire, once the goal is linked', async () => {
    const stakes = await seededStakes(true);
    const r = await stakes('PAY-142');
    expect(r).toMatchObject({
      ok: true,
      data: {
        score: 89,
        suggestedPriority: 'Highest',
        currentPriority: 'Low',
        badges: ['silent-fire'],
        confidence: 'high',
      },
    });
    if (!r.ok) return;
    expect(
      new Set(r.data.evidence.filter((e) => e.type === 'customer').map((e) => e.title)),
    ).toEqual(new Set(['Kilima Freight', 'Savanna Health', 'Bluepeak Retail']));
    expect(r.data.evidence.every((e) => e.url && e.source)).toBe(true);
  });

  it('shows PAY-142 at 83 before the goal is linked, still a silent fire', async () => {
    const r = await (await seededStakes(false))('PAY-142');
    expect(r).toMatchObject({
      ok: true,
      data: { score: 83, suggestedPriority: 'Highest', badges: ['silent-fire'] },
    });
  });

  it('shows the other hero issues as the story says', async () => {
    const stakes = await seededStakes(true);
    expect(await stakes('PAY-118')).toMatchObject({
      ok: true,
      data: { score: 72, suggestedPriority: 'High', badges: ['stakes-jump'] },
    });
    expect(await stakes('PAY-131')).toMatchObject({
      ok: true,
      data: { score: 25, suggestedPriority: 'Low', badges: [] },
    });
    expect(await stakes('PAY-150')).toMatchObject({
      ok: true,
      data: { score: 0, suggestedPriority: 'Lowest', badges: ['phantom'] },
    });
    expect(await stakes('PAY-147')).toMatchObject({ ok: true, data: { score: 0, evidence: [] } });
  });
});
