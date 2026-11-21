import { describe, expect, it, vi } from 'vitest';
import { fakeKvs, MAX_VALUE_BYTES } from '../fakes/kvs';
import { bulkyEvidence, snapshot } from '../fakes/snapshot';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));

const {
  DEFAULT_SETTINGS,
  EMPTY_SEED_STATUS,
  makeAuditStore,
  makeConnectionStore,
  makeDigestStore,
  makeHistoryStore,
  makeMirrorStore,
  makePercentileStore,
  makeSeedStore,
  makeSettingsStore,
  makeShipNoticeStore,
  makeSnapshotStore,
  storageKey,
} = await import('../../src/adapters/storage');

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
    await store.save(snapshot({ issueKey: 'OPS-1', projectKey: 'OPS', score: 99 }));
    expect((await store.forProject('PAY')).map((s) => s.issueKey)).toEqual(['PAY-142', 'PAY-118']);
  });

  it('fits a snapshot with 40 bulky evidence items inside one stored value', async () => {
    const big = snapshot({ evidence: Array.from({ length: 40 }, (_, i) => bulkyEvidence(i)) });
    const size = Buffer.byteLength(JSON.stringify(big));
    expect(size).toBeLessThan(MAX_VALUE_BYTES / 4);
    await expect(makeSnapshotStore(fakeKvs().kvs).save(big)).resolves.toBeUndefined();
  });
});

describe('digest storage', () => {
  it('keeps page refs by project and the latest run status', async () => {
    const { kvs, plain } = fakeKvs();
    const store = makeDigestStore(kvs);
    expect(await store.lastPage('PAY')).toBeNull();
    expect(await store.lastRun()).toBeNull();
    await store.saveLastPage('PAY', { pageId: '200', weekStart: '2026-11-16' });
    const run = {
      at: '2026-11-16T06:00:00.000Z',
      status: 'skipped' as const,
      reason: 'confluence-not-connected' as const,
      created: 0,
      updated: 0,
      failed: 0,
    };
    await store.saveRun(run);
    expect(await store.lastPage('PAY')).toEqual({ pageId: '200', weekStart: '2026-11-16' });
    expect(await store.lastRun()).toEqual(run);
    expect(plain.get('digest:last:PAY')).toEqual({ pageId: '200', weekStart: '2026-11-16' });
  });

  it('finds sent notices by sent time, not when they were created', async () => {
    const store = makeShipNoticeStore(fakeKvs().kvs);
    const base = {
      id: 'PAY-1:done:none',
      issueKey: 'PAY-1',
      trigger: 'done' as const,
      versionId: null,
      versionName: null,
      recipients: [],
      jsmRequests: [],
      customers: [],
      internalDraft: '',
      internalGenerated: false,
      citedIds: [],
      status: 'sent' as const,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-11-15T08:00:00.000Z',
      sentBy: 'account-1',
      sentAt: '2026-11-15T08:00:00.000Z',
      dismissedBy: null,
    };
    await store.save(base);
    await store.save({
      ...base,
      id: 'PAY-2:done:none',
      issueKey: 'PAY-2',
      sentAt: '2026-11-01T08:00:00.000Z',
    });
    await store.save({ ...base, id: 'PAY-3:done:none', status: 'pending', sentAt: null });
    expect((await store.sentSince('2026-11-09T00:00:00.000Z')).map((n) => n.issueKey)).toEqual([
      'PAY-1',
    ]);
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

describe('llm store', () => {
  it('caches text, counts usage and rejections per day, and purges by last use', async () => {
    const { makeLlmStore } = await import('../../src/adapters/storage');
    const kvs = fakeKvs();
    const llm = makeLlmStore(kvs.kvs);
    const entry = (usedAt: string) => ({
      text: 't',
      citedIds: ['ev-a'],
      createdAt: usedAt,
      usedAt,
    });
    await llm.saveCached('abc:CUST-007:customer:brief', entry('2026-09-01T00:00:00.000Z'));
    await llm.saveCached('def:summary', entry('2026-11-19T00:00:00.000Z'));
    expect(await llm.cached('abc:CUST-007:customer:brief')).toEqual(
      entry('2026-09-01T00:00:00.000Z'),
    );
    expect(await llm.cached('missing:summary')).toBeNull();
    expect(await llm.purgeCacheUnusedBefore('2026-10-21T00:00:00.000Z')).toBe(1);
    expect(await llm.cached('abc:CUST-007:customer:brief')).toBeNull();
    expect(await llm.cached('def:summary')).not.toBeNull();

    await llm.addUsage('2026-11-20', {
      credits: 2.5,
      calls: 1,
      inputTokens: 2000,
      outputTokens: 100,
    });
    expect(
      await llm.addUsage('2026-11-20', { credits: 1, calls: 1, inputTokens: 5, outputTokens: 5 }),
    ).toEqual({
      credits: 3.5,
      calls: 2,
      inputTokens: 2005,
      outputTokens: 105,
    });
    expect(await llm.addRejection('2026-11-20')).toBe(1);
    expect(await llm.addRejection('2026-11-20')).toBe(2);
    await llm.deleteDay('2026-11-20');
    expect(await llm.usage('2026-11-20')).toEqual({
      credits: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(await llm.rejections('2026-11-20')).toBe(0);
  });

  it('reads a bare credit count written by early builds', async () => {
    const { makeLlmStore } = await import('../../src/adapters/storage');
    const kvs = fakeKvs();
    await kvs.kvs.set('llm:usage:2026-11-20', 12);
    expect((await makeLlmStore(kvs.kvs).usage('2026-11-20')).credits).toBe(12);
  });
});
