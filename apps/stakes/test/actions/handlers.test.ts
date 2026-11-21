import { describe, expect, it, vi } from 'vitest';
import {
  draftCustomerUpdateAction,
  findCustomerExposureAction,
  getIssueStakesAction,
  getReleaseStakesAction,
  getScoreTrendAction,
  rankBacklogAction,
  suggestSprintScopeAction,
  topEvidence,
  type ActionDeps,
} from '../../src/actions/handlers';
import { readActionContext } from '../../src/actions/index';
import { makeShipNoticeStore } from '../../src/adapters/storage';
import { fakeKvs } from '../fakes/kvs';
import {
  fakeStakesDeps,
  issueDetails,
  linkedRequest,
  mirrorCustomer,
  mirrorDeal,
  NOW,
  SITE,
} from '../fakes/deps';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('@forge/api', () => ({ default: { asUser: vi.fn(), asApp: vi.fn() }, route: vi.fn() }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

async function setup(opts: { canView?: (k: string) => boolean } = {}) {
  const f = fakeStakesDeps({ requests: [linkedRequest('HELP-1', { priority: 'High' })] });
  await f.mirror.upsertCustomers([
    mirrorCustomer('CUST-007', 'enterprise', { name: 'Kilima Freight', ownerAccountId: 'owner-1' }),
    mirrorCustomer('CUST-012', 'enterprise', { name: 'Kilima Foods' }),
  ]);
  await f.mirror.upsertDeals([
    mirrorDeal('DEAL-031', 'CUST-007', 220_000, 0.6, { issueKeys: ['PAY-142', 'PAY-118'] }),
  ]);
  const issues: Record<string, ReturnType<typeof issueDetails>> = {
    'PAY-142': issueDetails({ fixVersions: ['2026.12'], assigneeAccountId: 'dev-1' }),
    'PAY-118': issueDetails({
      key: 'PAY-118',
      summary: 'Webhook retries',
      status: 'In Progress',
      url: `${SITE}/browse/PAY-118`,
    }),
  };
  f.jira.issue.mockImplementation(async (k?: string) => issues[k ?? ''] ?? null);
  const canView = opts.canView ?? (() => true);
  const reader = {
    canView: vi.fn(async (k: string) => canView(k)),
    issue: f.jira.issue,
    displayNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Name of ${id}`]))),
    projects: vi.fn(async () => [{ key: 'PAY', name: 'Orbit Pay', type: 'software' }]),
    openIssues: vi.fn(async () => Object.values(issues)),
    unreleasedVersions: vi.fn(async () => [{ id: '10200', name: '2026.12' }]),
  };
  const text = {
    write: vi.fn(async (req: { fallback?: { text: string } }) => ({
      text: req.fallback?.text ?? 'Good news: the fix for "CSV export" (PAY-142) has shipped.',
      citedIds: [],
      generated: false,
    })),
  };
  const deps: ActionDeps = {
    jira: reader,
    stakes: f.deps,
    backlog: {
      jira: reader,
      snapshots: f.deps.snapshots,
      settings: f.settings,
      mirror: f.mirror,
      percentiles: { get: f.deps.percentiles.get, save: vi.fn(async () => {}) },
      stakes: f.deps,
      clock: () => NOW,
    },
    release: { jira: reader, snapshots: f.deps.snapshots, mirror: f.mirror },
    customers: { jira: reader, mirror: f.mirror, snapshots: f.deps.snapshots },
    shipNotice: {
      jira: reader,
      writer: { addComment: vi.fn(), addRequestComment: vi.fn(), setProperty: vi.fn() },
      notices: makeShipNoticeStore(fakeKvs().kvs),
      stakes: f.deps,
      text,
      siteUrl: SITE,
      clock: () => NOW,
    },
    settings: f.settings,
    history: f.history,
    siteUrl: SITE,
    clock: () => NOW,
  };
  return { deps, f, reader, text };
}

describe('get-issue-stakes', () => {
  it('answers with score, signals, customers, owners, evidence and sources', async () => {
    const { deps } = await setup();
    const r = await getIssueStakesAction(deps, { issueKey: ' pay-142 ' });
    if (!r.ok) throw new Error(r.error.message);
    const d = r.data;
    expect(d).toMatchObject({
      issueKey: 'PAY-142',
      status: 'To Do',
      assignee: 'Name of dev-1',
      fixVersions: ['2026.12'],
      currentPriority: 'Low',
    });
    expect(d.score).toBeGreaterThan(0);
    expect(d.signals).toHaveLength(6);
    expect(d.customers[0]).toMatchObject({ name: 'Kilima Freight', dealValue: 'US$220K' });
    expect(d.evidence.length).toBeLessThanOrEqual(10);
    expect(d.sources[0]).toEqual({ title: 'PAY-142 in Jira', url: `${SITE}/browse/PAY-142` });
    expect(d.sources.length).toBe(d.evidence.length + 1);
  });

  it('refuses an issue the caller cannot view, and a malformed key', async () => {
    const { deps, f } = await setup({ canView: () => false });
    expect(await getIssueStakesAction(deps, { issueKey: 'PAY-142' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await getIssueStakesAction(deps, { issueKey: 'PAY-1 OR 1=1' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(f.graph.dealsForIssue).not.toHaveBeenCalled();
  });

  it('never asks the model for a summary', async () => {
    const { deps, f } = await setup();
    await getIssueStakesAction(deps, { issueKey: 'PAY-142' });
    expect(f.writer.write).not.toHaveBeenCalled();
  });
});

describe('rank-backlog', () => {
  it('ranks cached snapshots and filters by badge', async () => {
    const { deps } = await setup();
    await getIssueStakesAction(deps, { issueKey: 'PAY-142' });
    const r = await rankBacklogAction(deps, { projectKey: 'pay', limit: '1' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data).toMatchObject({ projectKey: 'PAY', filter: 'all', openIssues: 2 });
    expect(r.data.issues).toHaveLength(1);
    expect(r.data.issues[0]).toMatchObject({ rank: 1, issueKey: 'PAY-142' });
    expect(r.data.note).toMatch(/1 issues have no fresh score/);
    const phantoms = await rankBacklogAction(deps, { projectKey: 'PAY', filter: 'phantoms' });
    expect(phantoms.ok && phantoms.data.issues).toEqual([]);
    expect(await rankBacklogAction(deps, { projectKey: 'PAY', filter: 'hot' })).toMatchObject({
      ok: false,
    });
  });
});

describe('find-customer-exposure', () => {
  it('finds a customer by name in any case, with open issues, status, owners and versions', async () => {
    const { deps } = await setup();
    const r = await findCustomerExposureAction(deps, { customer: 'kilima freight' });
    if (!r.ok || !('customer' in r.data)) throw new Error('expected exposure');
    expect(r.data.customer).toMatchObject({
      id: 'CUST-007',
      name: 'Kilima Freight',
      accountOwner: 'Name of owner-1',
    });
    expect(r.data.dealValueAtRisk).toBe('US$220K');
    expect(r.data.openIssues.map((i) => [i.issueKey, i.status, i.targetVersions])).toEqual([
      ['PAY-142', 'To Do', ['2026.12']],
      ['PAY-118', 'In Progress', []],
    ]);
    expect(r.data.openIssues[0]!.assignee).toBe('Name of dev-1');
    expect(r.data.sources).toHaveLength(2);
  });

  it('asks which one when a prefix matches several customers', async () => {
    const { deps } = await setup();
    expect(await findCustomerExposureAction(deps, { customer: 'Kilima' })).toMatchObject({
      ok: true,
      data: {
        matches: expect.arrayContaining([
          expect.objectContaining({ name: 'Kilima Freight' }),
          expect.objectContaining({ name: 'Kilima Foods' }),
        ]),
      },
    });
  });

  it('accepts an id and reports an unknown customer', async () => {
    const { deps } = await setup();
    expect(await findCustomerExposureAction(deps, { customer: 'CUST-007' })).toMatchObject({
      ok: true,
      data: { customer: { name: 'Kilima Freight' } },
    });
    expect(await findCustomerExposureAction(deps, { customer: 'Nobody' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('leaves out issues the caller cannot open', async () => {
    const { deps, f } = await setup();
    f.jira.issue.mockImplementation(async (k?: string) =>
      k === 'PAY-142' ? issueDetails() : null,
    );
    const r = await findCustomerExposureAction(deps, { customer: 'Kilima Freight' });
    expect(r.ok && 'openIssues' in r.data && r.data.openIssues.map((i) => i.issueKey)).toEqual([
      'PAY-142',
    ]);
  });
});

describe('get-release-stakes', () => {
  it('resolves a version by name without a project and totals the revenue it unblocks', async () => {
    const { deps } = await setup();
    await getIssueStakesAction(deps, { issueKey: 'PAY-142' });
    expect(await getReleaseStakesAction(deps, { version: '2026.12' })).toMatchObject({
      ok: true,
      data: {
        projectKey: 'PAY',
        version: '2026.12',
        revenueUnblocked: 'US$220K',
        openDeals: 1,
        customersServed: ['Kilima Freight'],
      },
    });
  });

  it('reports a version that does not exist', async () => {
    const { deps } = await setup();
    expect(
      await getReleaseStakesAction(deps, { version: '2099.1', projectKey: 'PAY' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('draft-customer-update', () => {
  it('drafts a general update that names no customer when none is given', async () => {
    const { deps, text } = await setup();
    const r = await draftCustomerUpdateAction(deps, { issueKey: 'PAY-142' });
    expect(r).toMatchObject({
      ok: true,
      data: { customer: null, tone: 'brief', generated: false },
    });
    const req = (
      text.write.mock.calls as unknown as Array<[{ forbiddenNames: string[]; evidence: unknown[] }]>
    )[0]![0];
    expect(req.forbiddenNames).toEqual(['Kilima Freight']);
    expect(req.evidence).toEqual([]);
    expect(r.ok && r.data.draft).not.toMatch(/Kilima|\$/);
  });

  it('resolves a customer by name, and lists the linked ones when it is not linked', async () => {
    const { deps } = await setup();
    expect(
      await draftCustomerUpdateAction(deps, {
        issueKey: 'PAY-142',
        customer: 'kilima freight',
        tone: 'detailed',
      }),
    ).toMatchObject({ ok: true, data: { customer: 'Kilima Freight', tone: 'detailed' } });
    expect(
      await draftCustomerUpdateAction(deps, { issueKey: 'PAY-142', customer: 'Tamu Foods' }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.stringContaining('Linked customers: Kilima Freight'),
      },
    });
  });
});

describe('get-score-trend', () => {
  it('returns an issue history with its change', async () => {
    const { deps, f } = await setup();
    await f.history.recordMany([
      {
        issueKey: 'PAY-142',
        projectKey: 'PAY',
        day: '2026-11-01',
        score: 60,
        badges: [],
        source: 'demo',
      },
      {
        issueKey: 'PAY-142',
        projectKey: 'PAY',
        day: '2026-11-20',
        score: 89,
        badges: ['stakes-jump'],
        source: 'demo',
      },
    ]);
    expect(await getScoreTrendAction(deps, { issueKey: 'PAY-142' })).toMatchObject({
      ok: true,
      data: { first: 60, last: 89, change: 29, stakesJump: true },
    });
  });

  it('lists the project movers, jumps first, limited to visible issues', async () => {
    const { deps, f } = await setup();
    await f.history.recordMany([
      {
        issueKey: 'PAY-142',
        projectKey: 'PAY',
        day: '2026-11-01',
        score: 60,
        badges: [],
        source: 'demo',
      },
      {
        issueKey: 'PAY-142',
        projectKey: 'PAY',
        day: '2026-11-20',
        score: 70,
        badges: [],
        source: 'demo',
      },
      {
        issueKey: 'PAY-118',
        projectKey: 'PAY',
        day: '2026-11-01',
        score: 45,
        badges: [],
        source: 'demo',
      },
      {
        issueKey: 'PAY-118',
        projectKey: 'PAY',
        day: '2026-11-20',
        score: 50,
        badges: ['stakes-jump'],
        source: 'demo',
      },
      {
        issueKey: 'PAY-999',
        projectKey: 'PAY',
        day: '2026-11-20',
        score: 99,
        badges: ['stakes-jump'],
        source: 'demo',
      },
    ]);
    const r = await getScoreTrendAction(deps, { projectKey: 'PAY' });
    if (!r.ok || !('movers' in r.data)) throw new Error('expected movers');
    expect(r.data.movers.map((m) => [m.issueKey, m.change, m.jump])).toEqual([
      ['PAY-118', 5, true],
      ['PAY-142', 10, false],
    ]);
  });

  it('needs an issue or a project', async () => {
    const { deps } = await setup();
    expect(await getScoreTrendAction(deps, {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});

describe('suggest-sprint-scope', () => {
  it('says it is not available yet', async () => {
    const { deps } = await setup();
    expect(
      await suggestSprintScopeAction(deps, { projectKey: 'PAY', sprint: 'Sprint 24' }),
    ).toMatchObject({ ok: true, data: { available: false } });
  });
});

describe('action context', () => {
  it('reads the cloud id from the inputs or the install context, and the caller from principal', () => {
    expect(
      readActionContext({ context: { cloudId: 'c-1' } }, { principal: { accountId: 'a-1' } }),
    ).toEqual({ accountId: 'a-1', cloudId: 'c-1' });
    expect(readActionContext({}, { installContext: 'ari:cloud:jira::site/c-2' })).toEqual({
      accountId: '',
      cloudId: 'c-2',
    });
  });

  it('orders the top evidence by contribution', async () => {
    const { deps, f } = await setup();
    await getIssueStakesAction(deps, { issueKey: 'PAY-142' });
    const s = (await f.deps.snapshots.latest('PAY-142'))!;
    expect(topEvidence(s, NOW, 1)[0]!.type).toBe('deal');
  });
});
