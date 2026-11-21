import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem, Snapshot } from '@stakes/contracts';
import {
  makeDigestStore,
  makeSettingsStore,
  makeShipNoticeStore,
  makeSnapshotStore,
  type ShipNotice,
} from '../../src/adapters/storage';
import { weeklyDigest } from '../../src/services/digest';
import { fakeKvs } from '../fakes/kvs';
import { snapshot } from '../fakes/snapshot';
import { templateWriter } from '../fakes/deps';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'warn').mockImplementation(() => {});

const NOW = new Date('2026-11-16T06:00:00.000Z');

function deal(id: string, issueKey: string, amountUsd: number): EvidenceItem {
  return {
    id: `ev-deal-${issueKey}-${id}`,
    type: 'deal',
    title: `Deal ${id}`,
    value: amountUsd,
    unit: 'USD',
    detail: 'Open deal',
    url: '',
    signal: 'R',
    source: 'mirror',
    fetchedAt: '2026-11-15T08:00:00.000Z',
    facts: {
      kind: 'deal',
      dealId: id,
      customerId: 'C1',
      amountUsd,
      probability: 0.5,
      stage: 'Negotiation',
      closeDate: null,
      closed: false,
      ownerAccountId: null,
    },
  };
}

function notice(issueKey: string, sentAt: string | null): ShipNotice {
  return {
    id: `${issueKey}:done`,
    issueKey,
    trigger: 'done',
    versionId: 'v1',
    versionName: 'Next release',
    recipients: [],
    jsmRequests: [],
    customers: [],
    internalDraft: '',
    internalGenerated: false,
    citedIds: [],
    status: sentAt ? 'sent' : 'pending',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: sentAt ?? '2026-11-01T08:00:00.000Z',
    sentBy: sentAt ? 'account-1' : null,
    sentAt,
    dismissedBy: null,
  };
}

function setup() {
  const kvs = fakeKvs();
  const settings = makeSettingsStore(kvs.kvs);
  const snapshots = makeSnapshotStore(kvs.kvs);
  const notices = makeShipNoticeStore(kvs.kvs);
  const digest = makeDigestStore(kvs.kvs);
  const confluence = {
    isConnected: vi.fn(async () => true),
    parentPages: vi.fn(async () => []),
    createPage: vi.fn(async (_parent: string, title: string, _body: string) => ({
      id: '200',
      title,
    })),
    updatePage: vi.fn(async (id: string, title: string) => ({ id, title })),
  };
  const writer = templateWriter();
  return {
    kvs,
    settings,
    snapshots,
    notices,
    digest,
    confluence,
    writer,
    deps: {
      settings,
      snapshots,
      notices,
      digest,
      confluence,
      writer,
      clock: () => NOW,
    },
  };
}

async function configure(f: ReturnType<typeof setup>) {
  await f.settings.save({
    ...(await f.settings.get()),
    digestEnabled: true,
    digestParentPageId: '100',
    projectsInScope: ['PAY'],
  });
}

describe('weekly digest', () => {
  it('builds every section from stored snapshots and seven-day sent notices', async () => {
    const f = setup();
    await configure(f);
    const rows: Snapshot[] = Array.from({ length: 6 }, (_, i) =>
      snapshot({
        issueKey: `PAY-${i + 1}`,
        score: 60 + i,
        badges: ['silent-fire'],
        evidence: [],
      }),
    );
    rows.push(
      snapshot({
        issueKey: 'PAY-7',
        score: 10,
        currentPriority: 'Highest',
        badges: ['phantom'],
      }),
      snapshot({
        issueKey: 'PAY-8',
        score: 90,
        evidence: [deal('D1', 'PAY-8', 100000), deal('D2', 'PAY-8', 50000)],
      }),
      snapshot({
        issueKey: 'PAY-9',
        score: 20,
        currentPriority: 'Highest',
        badges: ['phantom'],
        evidence: [deal('D1', 'PAY-9', 100000)],
      }),
      snapshot({ issueKey: 'OPS-1', projectKey: 'OPS', score: 99 }),
    );
    for (const row of rows) await f.snapshots.save(row);
    await f.notices.save(notice('PAY-8', '2026-11-15T10:00:00.000Z'));
    await f.notices.save(notice('PAY-9', '2026-11-14T10:00:00.000Z'));
    await f.notices.save(notice('PAY-10', '2026-11-01T10:00:00.000Z'));
    await f.notices.save(notice('PAY-11', null));

    const result = await weeklyDigest(f.deps);

    expect(result).toMatchObject({ status: 'completed', created: 1, updated: 0, failed: 0 });
    expect(f.confluence.createPage).toHaveBeenCalledOnce();
    const [parent, title, body] = f.confluence.createPage.mock.calls[0]!;
    expect(parent).toBe('100');
    expect(title).toBe('Stakes weekly digest · PAY · 2026-11-16');
    expect(body).toContain('<td>PAY-6</td>');
    expect(body).toContain('<td>PAY-2</td>');
    expect(body).not.toContain('<td>PAY-1</td>');
    expect(body).toContain('<strong>PAY-8</strong>');
    expect(body).toContain('<strong>PAY-9</strong>');
    expect(body).not.toContain('<strong>PAY-10</strong>');
    expect(body).toContain('US$150K across 2 open deals.');
    expect(body).toContain('<td>PAY-7</td>');
    expect(body).not.toContain('<td>PAY-9</td>');
    expect(body).not.toContain('OPS-1');
    expect(f.writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'digest',
        cacheKey: expect.stringMatching(/^digest:[0-9a-f]{64}$/),
        fallback: expect.objectContaining({ text: expect.stringContaining('shipped fixes') }),
      }),
    );
    expect(body).toContain('This week’s digest covers');
    expect(await f.digest.lastPage('PAY')).toEqual({ pageId: '200', weekStart: '2026-11-16' });
  });

  it('updates the same week page instead of creating a duplicate', async () => {
    const f = setup();
    await configure(f);
    await f.snapshots.save(snapshot());

    expect(await weeklyDigest(f.deps)).toMatchObject({ created: 1, updated: 0 });
    expect(await weeklyDigest(f.deps)).toMatchObject({ created: 0, updated: 1 });

    expect(f.confluence.createPage).toHaveBeenCalledOnce();
    expect(f.confluence.updatePage).toHaveBeenCalledOnce();
    expect(f.confluence.updatePage).toHaveBeenCalledWith(
      '200',
      'Stakes weekly digest · PAY · 2026-11-16',
      expect.any(String),
    );
    expect(f.kvs.plain.get('digest:last:PAY')).toEqual({
      pageId: '200',
      weekStart: '2026-11-16',
    });
  });

  it('does not reuse cached digest text after its evidence changes', async () => {
    const f = setup();
    await configure(f);
    await f.snapshots.save(
      snapshot({
        issueKey: 'PAY-1',
        badges: ['silent-fire'],
        evidence: [deal('D1', 'PAY-1', 100000)],
      }),
    );
    await weeklyDigest(f.deps);
    const firstKey = f.writer.write.mock.calls[0]![0].cacheKey;

    await f.snapshots.save(
      snapshot({
        issueKey: 'PAY-1',
        badges: ['silent-fire'],
        evidence: [deal('D2', 'PAY-1', 200000)],
      }),
    );
    await weeklyDigest(f.deps);
    const secondKey = f.writer.write.mock.calls[1]![0].cacheKey;

    expect(secondKey).not.toBe(firstKey);
  });

  it('records and returns the disconnected skip without reading snapshots', async () => {
    const f = setup();
    await configure(f);
    f.confluence.isConnected.mockResolvedValue(false);
    const projectRead = vi.spyOn(f.snapshots, 'forProject');

    const result = await weeklyDigest(f.deps);

    expect(result).toEqual({
      at: NOW.toISOString(),
      status: 'skipped',
      reason: 'confluence-not-connected',
      created: 0,
      updated: 0,
      failed: 0,
    });
    expect(await f.digest.lastRun()).toEqual(result);
    expect(projectRead).not.toHaveBeenCalled();
    expect(f.confluence.createPage).not.toHaveBeenCalled();
    expect(f.writer.write).not.toHaveBeenCalled();
  });

  it('does nothing when the scheduled digest is off, but allows a manual run', async () => {
    const f = setup();
    await f.settings.save({
      ...(await f.settings.get()),
      digestParentPageId: '100',
      projectsInScope: ['PAY'],
    });

    expect(await weeklyDigest(f.deps)).toMatchObject({
      status: 'skipped',
      reason: 'digest-disabled',
    });
    expect(f.confluence.isConnected).not.toHaveBeenCalled();

    expect(await weeklyDigest(f.deps, { manual: true })).toMatchObject({
      status: 'completed',
      created: 1,
    });
  });
});
