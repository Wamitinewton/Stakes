import { describe, expect, it, vi } from 'vitest';
import {
  listBacklog,
  recomputeBatch,
  toBacklogRow,
  updatePercentiles,
  type BacklogDeps,
} from '../../src/services/rankBacklog';
import { fakeStakesDeps, issueDetails, NOW } from '../fakes/deps';
import { snapshot } from '../fakes/snapshot';
import { customer } from '../core/evidence';
import { makePercentileStore } from '../../src/adapters/storage';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

async function backlogDeps(issues = [issueDetails()]) {
  const f = fakeStakesDeps();
  const deps: BacklogDeps = {
    ...f.deps,
    jira: { ...f.deps.jira, canView: f.jira.canView, openIssues: vi.fn(async () => issues) },
    percentiles: makePercentileStore(f.store.kvs),
    stakes: f.deps,
    clock: () => NOW,
  };
  return { f, deps };
}

describe('toBacklogRow', () => {
  it('includes issue links and customer names used by the table', () => {
    const issue = issueDetails();
    const result = toBacklogRow(
      issue,
      snapshot({ evidence: [customer('Example customer', 'smb')] }),
    );

    expect(result).toMatchObject({
      issueUrl: issue.url,
      customers: 1,
      customerNames: ['Example customer'],
    });
  });
});

describe('listBacklog', () => {
  it('returns ranked cached rows and only issues whose snapshots are stale', async () => {
    const issues = [
      issueDetails(),
      issueDetails({ key: 'PAY-150', summary: 'Refresh settings icon', priority: 'Highest' }),
    ];
    const { deps } = await backlogDeps(issues);
    await deps.stakes.snapshots.save(
      snapshot({ raw: { R: 1000, S: 0, C: 0, H: 0, G: 0, U: null } }),
    );

    const result = await listBacklog(deps, 'PAY');

    expect(result.staleKeys).toEqual(['PAY-150']);
    expect(result.rows.map((row) => row.issueKey)).toEqual(['PAY-142', 'PAY-150']);
    expect(result.rows[0]).toMatchObject({ score: 89, revenueUsd: 1000, badges: ['silent-fire'] });
    expect(result.rows[1]).toMatchObject({ score: null, currentPriority: 'Highest' });
    expect(result.summary).toMatchObject({ total: 2, scored: 1, silentFires: 1, revenueUsd: 0 });
  });

  it('marks a cached snapshot stale when the mirror or weights have changed', async () => {
    const { f, deps } = await backlogDeps();
    await deps.stakes.snapshots.save(snapshot());
    await f.mirror.bumpDealsVersion();

    expect((await listBacklog(deps, 'PAY')).staleKeys).toEqual(['PAY-142']);
  });
});

describe('recomputeBatch', () => {
  it('recomputes and returns display rows', async () => {
    const { deps } = await backlogDeps();
    const result = await recomputeBatch(deps, ['PAY-142']);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ issueKey: 'PAY-142', summary: issueDetails().summary });
    expect(result.rows[0]!.score).not.toBeNull();
  });

  it('skips inaccessible issues before recomputing or reading snapshots', async () => {
    const { f, deps } = await backlogDeps();
    deps.jira.canView = vi.fn(async (issueKey) => issueKey === 'PAY-142');
    const latest = vi.spyOn(deps.stakes.snapshots, 'latest');

    const result = await recomputeBatch(deps, ['PAY-142', 'PAY-143']);

    expect(result.rows.map((row) => row.issueKey)).toEqual(['PAY-142']);
    expect(f.jira.issue).toHaveBeenCalledTimes(2);
    expect(f.jira.issue).not.toHaveBeenCalledWith('PAY-143');
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledWith('PAY-142');
  });
});

describe('updatePercentiles', () => {
  it('keeps seeded percentiles until ten non-demo issues have scores', async () => {
    const demo = issueDetails({ labels: ['stakes-demo'] });
    const { deps } = await backlogDeps([demo]);
    await deps.stakes.snapshots.save(snapshot());
    const seeded = { R: 450000, S: 18, C: 9, H: 10, scoredCount: 25, at: 'seed', seeded: true };
    await deps.percentiles.save('PAY', seeded);

    expect(await updatePercentiles(deps, 'PAY')).toEqual(seeded);
  });

  it('recomputes p95s from scored non-demo open issues', async () => {
    const issues = Array.from({ length: 10 }, (_, index) =>
      issueDetails({ key: `PAY-${index + 1}`, labels: [] }),
    );
    const { deps } = await backlogDeps(issues);
    for (const [index, issue] of issues.entries()) {
      await deps.stakes.snapshots.save(
        snapshot({
          issueKey: issue.key,
          raw: { R: index + 1, S: index + 1, C: index + 1, H: index + 1, G: 0, U: null },
        }),
      );
    }

    const result = await updatePercentiles(deps, 'PAY');

    expect(result).toEqual({
      R: 10,
      S: 10,
      C: 10,
      H: 10,
      scoredCount: 10,
      at: NOW.toISOString(),
      seeded: false,
    });
    expect(await deps.percentiles.get('PAY')).toEqual(result);
  });
});
