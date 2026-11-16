import { describe, expect, it, vi } from 'vitest';
import { fakeKvs, MAX_VALUE_BYTES } from '../fakes/kvs.js';
import { bulkyEvidence, snapshot } from '../fakes/snapshot.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));

const {
  DEFAULT_SETTINGS,
  EMPTY_SEED_STATUS,
  makeAuditStore,
  makeConnectionStore,
  makeHistoryStore,
  makeMirrorStore,
  makePercentileStore,
  makeSeedStore,
  makeSettingsStore,
  makeSnapshotStore,
  storageKey,
} = await import('../../src/adapters/storage.js');

const customer = (id: string, source: 'csv' | 'demo' = 'demo') => ({
  id,
  name: `Customer ${id}`,
  tier: 'enterprise' as const,
  arrUsd: 420000,
  renewalDate: null,
  ownerAccountId: 'acc-1',
  source,
});

const deal = (id: string, issueKeys: string[], source: 'csv' | 'demo' = 'demo') => ({
  id,
  customerId: 'CUST-1',
  name: `Deal ${id}`,
  amountUsd: 100000,
  stage: 'Negotiation',
  probability: 0.6,
  closeDate: '2026-12-15',
  closed: false,
  ownerAccountId: null,
  issueKeys,
  source,
});

describe('storageKey', () => {
  it('keeps safe ids readable and escapes anything else reversibly', () => {
    expect(storageKey('PAY-142')).toBe('PAY-142');
    expect(storageKey('DEAL/31', 'PAY-1')).toBe('DEAL_2f_31:PAY-1');
    expect(storageKey('a b')).not.toBe(storageKey('a_b'));
  });
});

describe('mirror store', () => {
  it('finds deals for an issue through the link rows, reading nulls back', async () => {
    const { kvs } = fakeKvs();
    const mirror = makeMirrorStore(kvs);
    await mirror.upsertDeals([deal('D1', ['PAY-142', 'PAY-118']), deal('D2', ['PAY-118'])]);
    expect((await mirror.dealsForIssue('PAY-142')).map((d) => d.id)).toEqual(['D1']);
    const forOther = await mirror.dealsForIssue('PAY-118');
    expect(forOther.map((d) => d.id).sort()).toEqual(['D1', 'D2']);
    expect(forOther[0]!.ownerAccountId).toBeNull();
    expect(await mirror.dealsForIssue('PAY-999')).toEqual([]);
  });

  it('replaces a deal’s issue links on re-import', async () => {
    const { kvs } = fakeKvs();
    const mirror = makeMirrorStore(kvs);
    await mirror.upsertDeals([deal('D1', ['PAY-142', 'PAY-118'])]);
    await mirror.upsertDeals([deal('D1', ['PAY-118'])]);
    expect(await mirror.dealsForIssue('PAY-142')).toEqual([]);
    expect((await mirror.dealsForIssue('PAY-118')).map((d) => d.issueKeys)).toEqual([['PAY-118']]);
  });

  it('reads customers by id and by direct issue link, and messages by issue', async () => {
    const { kvs } = fakeKvs();
    const mirror = makeMirrorStore(kvs);
    await mirror.upsertCustomers([customer('C1'), customer('C2')]);
    await mirror.linkCustomers([{ customerId: 'C2', issueKey: 'PAY-131', source: 'demo' }]);
    await mirror.upsertMessages([
      {
        id: 'M1',
        issueKey: 'PAY-142',
        channel: '#cs',
        author: 'A',
        text: 't',
        at: '2026-11-19T08:00:00Z',
        url: 'u',
        source: 'demo',
      },
    ]);
    expect((await mirror.customersByIds(['C1', 'C1', 'nope'])).map((c) => c.id)).toEqual(['C1']);
    expect((await mirror.customersForIssue('PAY-131')).map((c) => c.id)).toEqual(['C2']);
    expect((await mirror.customersByIds(['C1']))[0]!.renewalDate).toBeNull();
    expect(await mirror.messagesForIssue('PAY-142')).toHaveLength(1);
  });

  it('reads more than one batch of deals', async () => {
    const { kvs, calls } = fakeKvs();
    const mirror = makeMirrorStore(kvs);
    await mirror.upsertDeals(Array.from({ length: 30 }, (_, i) => deal(`D${i}`, ['PAY-1'])));
    calls.batchGet = 0;
    expect(await mirror.dealsForIssue('PAY-1')).toHaveLength(30);
    expect(calls.batchGet).toBe(2);
  });

  it('deletes only rows from the given source', async () => {
    const { kvs } = fakeKvs();
    const mirror = makeMirrorStore(kvs);
    await mirror.upsertCustomers([customer('C1', 'demo'), customer('C2', 'csv')]);
    await mirror.upsertDeals([deal('D1', ['PAY-1'], 'demo'), deal('D2', ['PAY-1'], 'csv')]);
    expect(await mirror.deleteBySource('demo')).toEqual({ customers: 1, deals: 1, messages: 0 });
    expect((await mirror.dealsForIssue('PAY-1')).map((d) => d.id)).toEqual(['D2']);
    expect((await mirror.customersByIds(['C1', 'C2'])).map((c) => c.id)).toEqual(['C2']);
  });

  it('bumps the deals version from zero', async () => {
    const mirror = makeMirrorStore(fakeKvs().kvs);
    expect(await mirror.dealsVersion()).toBe(0);
    expect(await mirror.bumpDealsVersion()).toBe(1);
    expect(await mirror.bumpDealsVersion()).toBe(2);
  });
});

describe('snapshot store', () => {
  it('saves and reads the latest snapshot per issue', async () => {
    const store = makeSnapshotStore(fakeKvs().kvs);
    expect(await store.latest('PAY-142')).toBeNull();
    await store.save(snapshot({ score: 70 }));
    await store.save(snapshot({ score: 89 }));
    expect((await store.latest('PAY-142'))?.score).toBe(89);
    await store.save(snapshot({ issueKey: 'PAY-118', score: 72 }));
    expect(
      (await store.latestMany(['PAY-142', 'PAY-118', 'PAY-1'])).map((s) => s.score).sort(),
    ).toEqual([72, 89]);
  });

  it('fits a snapshot with 40 bulky evidence items inside one stored value', async () => {
    const big = snapshot({ evidence: Array.from({ length: 40 }, (_, i) => bulkyEvidence(i)) });
    const size = Buffer.byteLength(JSON.stringify(big));
    expect(size).toBeLessThan(MAX_VALUE_BYTES / 4);
    await expect(makeSnapshotStore(fakeKvs().kvs).save(big)).resolves.toBeUndefined();
  });
});

describe('history store', () => {
  const point = (day: string, score: number, source: 'computed' | 'demo' = 'computed') => ({
    issueKey: 'PAY-118',
    projectKey: 'PAY',
    day,
    score,
    badges: [],
    source,
  });

  it('keeps one row per day and finds the score on or before a day', async () => {
    const history = makeHistoryStore(fakeKvs().kvs);
    await history.recordMany([
      point('2026-11-10', 40),
      point('2026-11-13', 52),
      point('2026-11-19', 70),
    ]);
    await history.record(point('2026-11-19', 72));
    expect(await history.scoreOnOrBefore('PAY-118', '2026-11-13')).toBe(52);
    expect(await history.scoreOnOrBefore('PAY-118', '2026-11-12')).toBe(40);
    expect(await history.scoreOnOrBefore('PAY-118', '2026-11-01')).toBeNull();
    expect((await history.since('PAY-118', '2026-11-11')).map((p) => p.score)).toEqual([52, 72]);
  });

  it('deletes only demo rows', async () => {
    const history = makeHistoryStore(fakeKvs().kvs);
    await history.recordMany([point('2026-11-10', 40, 'demo'), point('2026-11-11', 41)]);
    expect(await history.deleteDemo()).toBe(1);
    expect((await history.since('PAY-118', '2026-11-01')).map((p) => p.day)).toEqual([
      '2026-11-11',
    ]);
  });

  it('purges rows older than the cutoff across all issues', async () => {
    const { kvs, rows } = fakeKvs();
    const history = makeHistoryStore(kvs);
    await history.recordMany([
      point('2026-10-20', 40),
      point('2026-10-21', 41),
      { ...point('2026-10-01', 20), issueKey: 'PAY-142' },
    ]);

    expect(await history.purgeBefore('2026-10-21')).toBe(2);
    expect([...rows('history').keys()]).toEqual(['PAY-118:2026-10-21']);
  });
});

describe('audit store', () => {
  it('purges rows older than the cutoff', async () => {
    const { kvs, rows } = fakeKvs();
    await kvs.entity('audit').set('old', { at: '2026-05-23T23:59:59.999Z' });
    await kvs.entity('audit').set('boundary', { at: '2026-05-24T10:00:00.000Z' });

    expect(await makeAuditStore(kvs).purgeBefore('2026-05-24T10:00:00.000Z')).toBe(1);
    expect([...rows('audit').keys()]).toEqual(['boundary']);
  });
});

describe('settings, percentiles, seed and connection stores', () => {
  it('returns defaults when nothing is saved and merges new defaults into old saves', async () => {
    const { kvs } = fakeKvs();
    const settings = makeSettingsStore(kvs);
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ weightsVersion: 1, llmEnabled: false });
    await kvs.set('settings:global', {
      weightsVersion: 4,
      bands: { priorities: { highest: 'P1' } },
    });
    const merged = await settings.get();
    expect(merged.weightsVersion).toBe(4);
    expect(merged.bands.priorities.highest).toBe('P1');
    expect(merged.bands.priorities.low).toBe('Low');
    expect(merged.weights).toEqual(DEFAULT_SETTINGS.weights);
    await settings.save({ ...merged, llmEnabled: true });
    expect((await settings.get()).llmEnabled).toBe(true);
  });

  it('stores percentiles per project', async () => {
    const store = makePercentileStore(fakeKvs().kvs);
    expect(await store.get('PAY')).toBeNull();
    const p = { R: 450000, S: 18, C: 9, H: 10, scoredCount: 25, at: 'now', seeded: true };
    await store.save('PAY', p);
    expect(await store.get('PAY')).toEqual(p);
    await store.delete('PAY');
    expect(await store.get('PAY')).toBeNull();
  });

  it('keeps seed status and the created-id record apart', async () => {
    const seed = makeSeedStore<{ ids: string[] }>(fakeKvs().kvs);
    expect(await seed.status()).toEqual(EMPTY_SEED_STATUS);
    await seed.saveStatus({ ...EMPTY_SEED_STATUS, state: 'loading' });
    await seed.saveRecord({ ids: ['PAY-1'] });
    expect((await seed.status()).state).toBe('loading');
    expect(await seed.record()).toEqual({ ids: ['PAY-1'] });
    await seed.clear();
    expect(await seed.record()).toBeNull();
  });

  it('stores, reads and clears the connector connection id', async () => {
    const store = makeConnectionStore(fakeKvs().kvs);
    expect(await store.get()).toBeNull();
    await store.set('conn-1');
    expect(await store.get()).toBe('conn-1');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe('fake kvs guards', () => {
  it('rejects undeclared entities, attributes and indexes', async () => {
    const { kvs } = fakeKvs();
    expect(() => kvs.entity('nope')).toThrow(/not declared/);
    await expect(kvs.entity('customer').set('C1', { colour: 'red' })).rejects.toThrow(
      /not declared/,
    );
    expect(() => kvs.entity('customer').query().index('by-colour')).toThrow(/not declared/);
  });
});

describe('nullable fields', () => {
  it('stores a snapshot with no suggested priority and reads null back', async () => {
    const store = makeSnapshotStore(fakeKvs().kvs);
    await store.save(snapshot({ suggestedPriority: null }));
    expect((await store.latest('PAY-142'))?.suggestedPriority).toBeNull();
  });

  it('rejects a value of the wrong type', async () => {
    const { kvs } = fakeKvs();
    await expect(kvs.entity('snapshot').set('x', { score: 'high' })).rejects.toThrow(
      /must be integer/,
    );
  });
});
