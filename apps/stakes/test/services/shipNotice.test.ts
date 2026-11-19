import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem } from '@stakes/contracts';
import {
  customerEvidence as customerItem,
  dealEvidence,
  requestEvidence,
} from '../../src/core/evidence.js';
import {
  makeShipNoticeStore,
  makeSnapshotStore,
  type ShipNotice,
} from '../../src/adapters/storage.js';
import {
  createNotice,
  customerEvidence,
  dismissShipNotice,
  draftCustomer,
  getShipNotice,
  internalComment,
  noticeId,
  onIssueUpdated,
  onVersionReleased,
  recipientsFor,
  requestNote,
  sendShipNotice,
  type CreateNoticeDeps,
} from '../../src/services/shipNotice.js';
import { fakeKvs } from '../fakes/kvs.js';
import { snapshot } from '../fakes/snapshot.js';
import { fakeStakesDeps, issueDetails, linkedRequest, NOW, SITE } from '../fakes/deps.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

const AT = NOW.toISOString();

const deal = (id: string, cust: string, name: string, amount: number, owner: string | null) =>
  dealEvidence(
    {
      id,
      name: 'Expansion',
      customerId: cust,
      customerName: name,
      amountUsd: amount,
      probability: 0.6,
      stage: 'Negotiation',
      closeDate: '2026-12-15',
      closed: false,
      ownerAccountId: owner,
      url: `${SITE}/d/${id}`,
    },
    'mirror',
    AT,
  );
const customer = (id: string, name: string, owner: string | null) =>
  customerItem(
    {
      id,
      name,
      tier: 'enterprise',
      arrUsd: 420_000,
      renewalDate: '2027-03-31',
      ownerAccountId: owner,
      url: `${SITE}/c/${id}`,
    },
    'mirror',
    AT,
  );
const request = (key: string) =>
  requestEvidence(
    {
      key,
      summary: 'Export fails',
      priority: 'High',
      createdAt: '2026-11-05T08:00:00.000Z',
      slaBreachAt: null,
      escalated: false,
      assigneeAccountId: 'agent-1',
      url: `${SITE}/browse/${key}`,
    },
    NOW,
    AT,
  );

const EVIDENCE: EvidenceItem[] = [
  deal('DEAL-031', 'CUST-007', 'Kilima Freight', 220_000, 'owner-amina'),
  deal('DEAL-034', 'CUST-012', 'Savanna Health', 160_000, 'owner-brian'),
  customer('CUST-007', 'Kilima Freight', 'owner-amina'),
  customer('CUST-012', 'Savanna Health', 'owner-brian'),
  request('HELP-1'),
];

function setup(
  opts: { score?: number; evidence?: EvidenceItem[]; status?: 'done' | 'indeterminate' } = {},
) {
  const kvs = fakeKvs();
  const snapshots = makeSnapshotStore(kvs.kvs);
  const notices = makeShipNoticeStore(kvs.kvs);
  const writer = {
    write: vi.fn(async () => ({
      text: 'PAY-142 shipped.',
      citedIds: ['ev-deal-DEAL-031'],
      generated: true,
    })),
  };
  const jira = {
    issue: vi.fn(async (key: string) =>
      issueDetails({ key, statusCategory: opts.status ?? 'done' }),
    ),
    linkedRequests: vi.fn(async () => ({
      requests: [
        linkedRequest('HELP-1', { assigneeAccountId: 'agent-1' }),
        linkedRequest('HELP-2', { assigneeAccountId: 'owner-amina' }),
      ],
      hidden: 0,
    })),
    issuesInVersion: vi.fn(async () => ['PAY-142', 'PAY-150']),
  };
  let now = NOW;
  const deps: CreateNoticeDeps = { jira, snapshots, notices, writer, clock: () => now };
  const ready = snapshots.save(
    snapshot({
      evidence: opts.evidence ?? EVIDENCE,
      score: opts.score ?? 89,
      evidenceHash: 'hash1',
    }),
  );
  return { deps, kvs, snapshots, notices, writer, jira, ready, later: (d: Date) => (now = d) };
}

const statusEvent = (key = 'PAY-142') => ({
  issue: { key },
  changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
});

describe('recipients', () => {
  it('lists each owner and agent once, with why they are on the notice', () => {
    const r = recipientsFor(snapshot({ evidence: EVIDENCE }), [
      { key: 'HELP-1', summary: 's', assigneeAccountId: 'agent-1' },
      { key: 'HELP-2', summary: 's', assigneeAccountId: 'owner-amina' },
      { key: 'HELP-3', summary: 's', assigneeAccountId: null },
    ]);
    expect(r).toEqual([
      {
        accountId: 'owner-amina',
        roles: ['deal-owner', 'customer-owner', 'request-assignee'],
        customers: ['Kilima Freight'],
        requestKeys: ['HELP-2'],
      },
      {
        accountId: 'owner-brian',
        roles: ['deal-owner', 'customer-owner'],
        customers: ['Savanna Health'],
        requestKeys: [],
      },
      { accountId: 'agent-1', roles: ['request-assignee'], customers: [], requestKeys: ['HELP-1'] },
    ]);
  });
});

describe('ship notice triggers', () => {
  it('creates a pending notice when an issue with stakes moves to Done', async () => {
    const t = setup();
    await t.ready;
    expect(await onIssueUpdated(t.deps, statusEvent())).toBe('created');
    const n = (await t.notices.get(noticeId('PAY-142', 'done', null)))!;
    expect(n).toMatchObject({
      issueKey: 'PAY-142',
      trigger: 'done',
      status: 'pending',
      versionName: null,
      internalDraft: 'PAY-142 shipped.',
      internalGenerated: true,
      customers: [
        { id: 'CUST-007', name: 'Kilima Freight' },
        { id: 'CUST-012', name: 'Savanna Health' },
      ],
    });
    expect(n.jsmRequests.map((r) => r.key)).toEqual(['HELP-1', 'HELP-2']);
    expect(n.recipients).toHaveLength(3);
    expect(t.writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'ship-internal', cacheKey: 'hash1:ship-internal:none' }),
    );
  });

  it('ignores edits that are not a status change, and moves to a status that is not Done', async () => {
    const t = setup();
    await t.ready;
    expect(
      await onIssueUpdated(t.deps, {
        issue: { key: 'PAY-142' },
        changelog: { items: [{ field: 'summary' }] },
      }),
    ).toBe('ignored');
    expect(
      await onIssueUpdated(t.deps, {
        issue: { key: 'not a key' },
        changelog: { items: [{ field: 'status' }] },
      }),
    ).toBe('ignored');
    const open = setup({ status: 'indeterminate' });
    await open.ready;
    expect(await onIssueUpdated(open.deps, statusEvent())).toBe('ignored');
    expect(t.jira.issue).not.toHaveBeenCalled();
  });

  it('accepts a changelog given as a bare list with field ids', async () => {
    const t = setup();
    await t.ready;
    expect(
      await onIssueUpdated(t.deps, {
        issue: { key: 'PAY-142' },
        changelog: [{ fieldId: 'status' }],
      }),
    ).toBe('created');
  });

  it('skips an issue without stakes', async () => {
    const t = setup({ score: 0, evidence: [] });
    await t.ready;
    expect(await onIssueUpdated(t.deps, statusEvent())).toBe('no-stakes');
    expect(await t.notices.forIssue('PAY-142')).toEqual([]);
  });

  it('updates the same notice when the event arrives twice', async () => {
    const t = setup();
    await t.ready;
    await onIssueUpdated(t.deps, statusEvent());
    t.later(new Date('2026-11-20T10:05:00.000Z'));
    expect(await onIssueUpdated(t.deps, statusEvent())).toBe('updated');
    const all = await t.notices.forIssue('PAY-142');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ createdAt: AT, updatedAt: '2026-11-20T10:05:00.000Z' });
  });

  it('adds the release to a pending Done notice instead of creating a second one', async () => {
    const t = setup();
    await t.ready;
    await onIssueUpdated(t.deps, statusEvent());
    const r = await onVersionReleased(t.deps, { version: { id: 10200, name: '2026.12' } });
    expect(r).toEqual({ created: 1, skipped: 1 });
    const all = await t.notices.forIssue('PAY-142');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: 'PAY-142:done:none',
      trigger: 'release',
      versionId: '10200',
      versionName: '2026.12',
    });
    expect(t.writer.write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cacheKey: 'hash1:ship-internal:10200',
        context: expect.objectContaining({ versionName: '2026.12' }),
      }),
    );
  });

  it('creates release notices only for issues with stakes, and is idempotent', async () => {
    const t = setup();
    await t.ready;
    expect(await onVersionReleased(t.deps, { version: { id: '10200', name: '2026.12' } })).toEqual({
      created: 1,
      skipped: 1,
    });
    expect(await onVersionReleased(t.deps, { version: { id: '10200', name: '2026.12' } })).toEqual({
      created: 1,
      skipped: 1,
    });
    expect(await t.notices.forIssue('PAY-142')).toHaveLength(1);
    expect(await t.notices.forIssue('PAY-150')).toEqual([]);
    expect(await onVersionReleased(t.deps, { version: { id: 'x', name: 'bad' } })).toEqual({
      created: 0,
      skipped: 0,
    });
  });

  it('does not bring back a dismissed notice, nor notify again soon after one was sent', async () => {
    const t = setup();
    await t.ready;
    await onIssueUpdated(t.deps, statusEvent());
    await dismissShipNotice({ notices: t.notices, clock: () => NOW }, 'PAY-142', 'acc-1');
    expect(await onIssueUpdated(t.deps, statusEvent())).toBe('closed');

    const s = setup();
    await s.ready;
    await onVersionReleased(s.deps, { version: { id: '1', name: 'v1' } });
    const n = (await s.notices.pendingFor('PAY-142'))!;
    await s.notices.save({ ...n, status: 'sent', sentAt: AT });
    expect(await onIssueUpdated(s.deps, statusEvent())).toBe('recently-sent');
    s.later(new Date('2026-12-20T10:00:00.000Z'));
    expect(await onIssueUpdated(s.deps, statusEvent())).toBe('created');
  });

  it('still creates the notice when linked requests cannot be read', async () => {
    const t = setup();
    await t.ready;
    t.jira.linkedRequests.mockRejectedValue(new Error('403'));
    expect(
      await createNotice(t.deps, { issueKey: 'PAY-142', trigger: 'done', version: null }),
    ).toBe('created');
    expect((await t.notices.pendingFor('PAY-142'))!.jsmRequests).toEqual([]);
  });
});

async function pending(t: ReturnType<typeof setup>): Promise<ShipNotice> {
  await t.ready;
  await onIssueUpdated(t.deps, statusEvent());
  return (await t.notices.pendingFor('PAY-142'))!;
}

describe('getShipNotice', () => {
  it('returns null when nothing is pending', async () => {
    const t = setup();
    expect(
      await getShipNotice(
        { jira: { canView: async () => true, issue: vi.fn() }, notices: t.notices, siteUrl: SITE },
        'PAY-142',
      ),
    ).toBeNull();
  });

  it('hides requests the viewer cannot open, and their assignees', async () => {
    const t = setup();
    await pending(t);
    const view = await getShipNotice(
      {
        jira: { canView: async (k: string) => k !== 'HELP-1', issue: vi.fn() },
        notices: t.notices,
        siteUrl: SITE,
      },
      'PAY-142',
    );
    expect(view!.requests).toEqual([
      {
        key: 'HELP-2',
        summary: 'Request HELP-2',
        assigneeAccountId: 'owner-amina',
        url: `${SITE}/browse/HELP-2`,
      },
    ]);
    expect(view!.hiddenRequests).toBe(1);
    expect(view!.recipients.map((r) => r.accountId)).toEqual(['owner-amina', 'owner-brian']);
    expect(JSON.stringify(view)).not.toContain('HELP-1');
  });
});

describe('customer drafts', () => {
  const snap = snapshot({ evidence: EVIDENCE, evidenceHash: 'hash1' });

  it('give a named customer only their own name, and forbid the others', () => {
    const c = customerEvidence(snap, { customerId: 'CUST-007' }, NOW)!;
    expect(c.name).toBe('Kilima Freight');
    expect(c.forbidden).toEqual(['Savanna Health']);
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]).toMatchObject({ value: null, unit: null, detail: '' });
    expect(JSON.stringify(c.evidence)).not.toMatch(/220|420|DEAL/);
  });

  it('give a request reply its age without priority, and forbid every customer name', () => {
    const c = customerEvidence(snap, { requestKey: 'HELP-1' }, NOW)!;
    expect(c.evidence[0]!.detail).toBe('open 15 days');
    expect(c.forbidden).toEqual(['Kilima Freight', 'Savanna Health']);
  });

  it('give a general update no evidence and forbid every customer name', () => {
    expect(customerEvidence(snap, {}, NOW)).toEqual({
      evidence: [],
      name: null,
      forbidden: ['Kilima Freight', 'Savanna Health'],
    });
    expect(customerEvidence(snap, { customerId: 'CUST-999' }, NOW)).toBeNull();
  });

  it('ask the writer for a Sonnet customer draft keyed by customer and tone', async () => {
    const f = fakeStakesDeps();
    await f.deps.snapshots.save(snap);
    const t = setup();
    const text = {
      write: vi.fn(async () => ({ text: 'Your fix shipped.', citedIds: [], generated: true })),
    };
    const r = await draftCustomer(
      { stakes: { ...f.deps, clock: () => NOW }, notices: t.notices, text, clock: () => NOW },
      { issueKey: 'PAY-142', customerId: 'CUST-007', tone: 'detailed' },
    );
    expect(r).toEqual({
      ok: true,
      data: { text: 'Your fix shipped.', citedIds: [], generated: true },
    });
    const calls = text.write.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]![0]).toMatchObject({
      purpose: 'customer',
      context: { issueKey: 'PAY-142', tone: 'detailed', customerName: 'Kilima Freight' },
      forbiddenNames: ['Savanna Health'],
    });
    expect(String(calls[0]![0].cacheKey)).toMatch(/:CUST-007:customer:detailed$/);
  });

  it('report an unlinked customer as not found', async () => {
    const f = fakeStakesDeps();
    await f.deps.snapshots.save(snap);
    const r = await draftCustomer(
      { stakes: f.deps, notices: setup().notices, text: { write: vi.fn() }, clock: () => NOW },
      { issueKey: 'PAY-142', customerId: 'CUST-999', tone: 'brief' },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('sending', () => {
  const writerFake = (fail: { comment?: boolean; request?: string; property?: boolean } = {}) => ({
    addComment: vi.fn(async () => {
      if (fail.comment) throw new Error('403');
      return '10500';
    }),
    addRequestComment: vi.fn(async (key: string) => {
      if (key === fail.request) throw new Error('403');
      return '20500';
    }),
    setProperty: vi.fn(async () => {
      if (fail.property) throw new Error('500');
    }),
  });
  const input = {
    issueKey: 'PAY-142',
    internalNote: 'PAY-142 shipped in 2026.12.\n\nPlease tell Kilima.',
    customerReplies: [
      { requestKey: 'HELP-1', text: 'Your export works now.', visibility: 'public-draft' as const },
      { requestKey: 'HELP-2', text: 'Shipped in 2026.12.', visibility: 'internal' as const },
    ],
  };

  it('posts one comment mentioning the owners, a note on each request, and the sent property', async () => {
    const t = setup();
    await pending(t);
    const writer = writerFake();
    const r = await sendShipNotice(
      {
        jira: { canView: async () => true, issue: vi.fn() },
        writer,
        notices: t.notices,
        clock: () => NOW,
      },
      input,
      'acc-amina',
    );
    expect(r).toEqual({
      ok: true,
      data: {
        commentId: '10500',
        replies: [
          { requestKey: 'HELP-1', ok: true },
          { requestKey: 'HELP-2', ok: true },
        ],
        propertyWritten: true,
      },
    });
    const adf = JSON.stringify((writer.addComment.mock.calls[0] as unknown[])[1]);
    expect(adf).toContain('"id":"owner-amina"');
    expect(adf).toContain('"id":"owner-brian"');
    expect(adf).not.toContain('"id":"agent-1"');
    expect(writer.addRequestComment).toHaveBeenCalledWith(
      'HELP-1',
      expect.stringMatching(/^Suggested reply to the customer/),
      { public: false },
    );
    expect(writer.addRequestComment).toHaveBeenCalledWith('HELP-2', 'Shipped in 2026.12.', {
      public: false,
    });
    expect(writer.setProperty).toHaveBeenCalledWith('PAY-142', 'stakes.shipNotice', {
      status: 'sent',
      internalNote: input.internalNote,
      ownerAccountIds: ['owner-amina', 'owner-brian'],
      sentAt: AT,
    });
    expect(await t.notices.pendingFor('PAY-142')).toBeNull();
    expect((await t.notices.forIssue('PAY-142'))[0]).toMatchObject({
      status: 'sent',
      sentBy: 'acc-amina',
      sentAt: AT,
    });
  });

  it('posts nothing else and keeps the notice pending when the comment fails', async () => {
    const t = setup();
    await pending(t);
    const writer = writerFake({ comment: true });
    const r = await sendShipNotice(
      {
        jira: { canView: async () => true, issue: vi.fn() },
        writer,
        notices: t.notices,
        clock: () => NOW,
      },
      input,
      'acc',
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
    expect(writer.addRequestComment).not.toHaveBeenCalled();
    expect(await t.notices.pendingFor('PAY-142')).not.toBeNull();
  });

  it('reports each failed request and a failed property without undoing the rest', async () => {
    const t = setup();
    await pending(t);
    const r = await sendShipNotice(
      {
        jira: { canView: async () => true, issue: vi.fn() },
        writer: writerFake({ request: 'HELP-2', property: true }),
        notices: t.notices,
        clock: () => NOW,
      },
      input,
      'acc',
    );
    expect(r).toMatchObject({
      ok: true,
      data: {
        replies: [
          { requestKey: 'HELP-1', ok: true },
          { requestKey: 'HELP-2', ok: false },
        ],
        propertyWritten: false,
      },
    });
    expect(await t.notices.pendingFor('PAY-142')).toBeNull();
  });

  it('refuses a reply to a request that is not on the notice, and a second send', async () => {
    const t = setup();
    await pending(t);
    const deps = {
      jira: { canView: async () => true, issue: vi.fn() },
      writer: writerFake(),
      notices: t.notices,
      clock: () => NOW,
    };
    expect(
      await sendShipNotice(
        deps,
        { ...input, customerReplies: [{ requestKey: 'OPS-9', text: 'x', visibility: 'internal' }] },
        'acc',
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await sendShipNotice(deps, input, 'acc');
    expect(await sendShipNotice(deps, input, 'acc')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('dismisses every pending notice for the issue', async () => {
    const t = setup();
    await pending(t);
    expect(
      await dismissShipNotice({ notices: t.notices, clock: () => NOW }, 'PAY-142', 'acc'),
    ).toEqual({ ok: true, dismissed: 1 });
    expect((await t.notices.forIssue('PAY-142'))[0]).toMatchObject({
      status: 'dismissed',
      dismissedBy: 'acc',
    });
  });
});

describe('message shapes', () => {
  it('splits the note into paragraphs and credits the sender', () => {
    const adf = internalComment('One.\n\nTwo.', ['a'], 'me');
    expect(adf.content).toHaveLength(4);
    expect(JSON.stringify(adf.content.at(-1))).toContain('"id":"me"');
    expect(internalComment('One.', [], 'me').content).toHaveLength(2);
  });

  it('labels a public draft as not sent', () => {
    expect(requestNote('Hi', 'public-draft', 'PAY-142')).toMatch(/has not been sent/);
    expect(requestNote('Hi', 'internal', 'PAY-142')).toBe('Hi');
  });
});
