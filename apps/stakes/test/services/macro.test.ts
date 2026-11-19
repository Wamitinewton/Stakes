import { describe, expect, it, vi } from 'vitest';
import type { IssueKey } from '@stakes/contracts';
import { jiraBacklogUrl, macroTable, type MacroDeps } from '../../src/services/macro.js';
import type { BacklogDeps } from '../../src/services/rankBacklog.js';
import { makePercentileStore } from '../../src/adapters/storage.js';
import {
  fakeStakesDeps,
  issueDetails,
  mirrorCustomer,
  mirrorDeal,
  NOW,
  SITE,
} from '../fakes/deps.js';
import { snapshot } from '../fakes/snapshot.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

function makeDeps(
  issues: ReturnType<typeof issueDetails>[],
  versions: Array<{ id: string; name: string }> = [],
) {
  const f = fakeStakesDeps();
  const issue = vi.fn(
    async (key: IssueKey) => issues.find((candidate) => candidate.key === key) ?? null,
  );
  const openIssues = vi.fn(async () => issues);
  const jira = { ...f.deps.jira, canView: f.jira.canView, issue, openIssues };
  const backlog: BacklogDeps = {
    ...f.deps,
    jira,
    stakes: f.deps,
    percentiles: makePercentileStore(f.store.kvs),
    clock: () => NOW,
  };
  const deps: MacroDeps = {
    backlog,
    release: {
      jira: { openIssues, unreleasedVersions: vi.fn(async () => versions) },
      snapshots: f.deps.snapshots,
      mirror: f.mirror,
    },
    customers: { jira, mirror: f.mirror, snapshots: f.deps.snapshots },
    jira,
    snapshots: f.deps.snapshots,
    siteUrl: SITE,
  };
  return { deps, f };
}

describe('macroTable', () => {
  it('returns the ten highest-scoring project rows and a real Jira backlog link', async () => {
    const issues = Array.from({ length: 12 }, (_, index) =>
      issueDetails({
        key: `PAY-${index + 1}`,
        url: `${SITE}/browse/PAY-${index + 1}`,
      }),
    );
    const { deps, f } = makeDeps(issues);
    for (const [index, issue] of issues.entries()) {
      await f.deps.snapshots.save(
        snapshot({
          issueKey: issue.key,
          score: index + 1,
          raw: { R: (index + 1) * 100, S: 0, C: 0, H: 0, G: 0, U: null },
        }),
      );
    }

    const result = await macroTable(deps, { mode: 'project', projectKey: 'PAY' });

    expect(result?.rows).toHaveLength(10);
    expect(result?.rows.map((row) => row.issueKey)).toEqual([
      'PAY-12',
      'PAY-11',
      'PAY-10',
      'PAY-9',
      'PAY-8',
      'PAY-7',
      'PAY-6',
      'PAY-5',
      'PAY-4',
      'PAY-3',
    ]);
    expect(result?.rows[0]).toMatchObject({
      issueUrl: `${SITE}/browse/PAY-12`,
      score: 12,
      priority: 'Low',
      badges: ['silent-fire'],
      revenueUsd: 1200,
    });
    expect(result?.backlogUrl).toBe(`${SITE}/jira/software/projects/PAY/backlog`);
  });

  it('reuses release stakes by version name and enriches priority, badges and revenue', async () => {
    const issues = [
      issueDetails({ key: 'PAY-1', priority: 'Medium', fixVersions: ['2026.12'] }),
      issueDetails({ key: 'PAY-2', priority: 'High', fixVersions: ['2026.12'] }),
      issueDetails({ key: 'PAY-3', fixVersions: ['2026.13'] }),
    ];
    const { deps, f } = makeDeps(issues, [{ id: '10001', name: '2026.12' }]);
    await f.deps.snapshots.save(
      snapshot({ issueKey: 'PAY-1', score: 40, raw: { R: 100, S: 0, C: 0, H: 0, G: 0, U: null } }),
    );
    await f.deps.snapshots.save(
      snapshot({
        issueKey: 'PAY-2',
        score: 90,
        badges: ['stakes-jump'],
        raw: { R: 250000, S: 0, C: 0, H: 0, G: 0, U: null },
      }),
    );

    const result = await macroTable(deps, {
      mode: 'version',
      projectKey: 'PAY',
      version: '2026.12',
    });

    expect(result?.rows.map((row) => row.issueKey)).toEqual(['PAY-2', 'PAY-1']);
    expect(result?.rows[0]).toMatchObject({
      score: 90,
      priority: 'High',
      badges: ['stakes-jump'],
      revenueUsd: 250000,
    });
    expect(result?.backlogUrl).toBe(jiraBacklogUrl(SITE, 'PAY'));
  });

  it('searches for a customer and ranks exposure using the same snapshot fields', async () => {
    const issues = [
      issueDetails({ key: 'PAY-1', priority: 'Low' }),
      issueDetails({ key: 'DEV-2', projectKey: 'DEV', priority: 'Highest' }),
    ];
    const { deps, f } = makeDeps(issues);
    await f.mirror.upsertCustomers([
      mirrorCustomer('CUST-007', 'enterprise', { name: 'Example Customer' }),
    ]);
    await f.mirror.upsertDeals([
      mirrorDeal('DEAL-1', 'CUST-007', 50000, 0.5, { issueKeys: ['PAY-1', 'DEV-2'] }),
    ]);
    await f.deps.snapshots.save(
      snapshot({ issueKey: 'PAY-1', score: 20, raw: { R: 100, S: 0, C: 0, H: 0, G: 0, U: null } }),
    );
    await f.deps.snapshots.save(
      snapshot({
        issueKey: 'DEV-2',
        projectKey: 'DEV',
        score: 95,
        badges: ['phantom'],
        raw: { R: 50000, S: 0, C: 0, H: 0, G: 0, U: null },
      }),
    );

    const result = await macroTable(deps, { mode: 'customer', query: 'example customer' });

    expect(result?.rows.map((row) => row.issueKey)).toEqual(['DEV-2', 'PAY-1']);
    expect(result?.rows[0]).toMatchObject({
      score: 95,
      priority: 'Highest',
      badges: ['phantom'],
      revenueUsd: 50000,
    });
    expect(result?.backlogUrl).toBe(`${SITE}/jira/software/projects/DEV/backlog`);
  });
});
