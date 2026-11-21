import { describe, expect, it, vi } from 'vitest';
import type { PriorityChange, Snapshot } from '@stakes/contracts';
import { JiraError } from '../../src/adapters/jira';
import { makeAuditStore, makeSnapshotStore } from '../../src/adapters/storage';
import { applyPriority, type ApplyPriorityDeps } from '../../src/services/applyPriority';
import { issueDetails, NOW } from '../fakes/deps';
import { fakeKvs } from '../fakes/kvs';
import { bulkyEvidence, snapshot } from '../fakes/snapshot';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

async function setup(
  options: {
    canView?: (issueKey: string) => boolean;
    priorities?: Record<string, string>;
    snapshots?: Snapshot[];
    updateError?: Error;
  } = {},
) {
  const store = fakeKvs();
  const snapshots = makeSnapshotStore(store.kvs);
  for (const s of options.snapshots ?? [snapshot()]) await snapshots.save(s);
  const writer = {
    updateIssue: vi.fn(
      async (_key: string, _input: { priority?: string; addLabels?: string[] }) => {
        if (options.updateError) throw options.updateError;
      },
    ),
    addComment: vi.fn(
      async (_key: string, _body: { type: 'doc'; version: 1; content: unknown[] }) => '10001',
    ),
  };
  const deps: ApplyPriorityDeps = {
    jira: {
      canView: vi.fn(async (issueKey) => options.canView?.(issueKey) ?? true),
      issue: vi.fn(async (issueKey) =>
        issueDetails({ key: issueKey, priority: options.priorities?.[issueKey] ?? 'Low' }),
      ),
    },
    writer,
    snapshots,
    audit: makeAuditStore(store.kvs),
    clock: () => NOW,
  };
  return { deps, writer, store };
}

const change = (issueKey = 'PAY-142', from = 'Low', to = 'Highest'): PriorityChange => ({
  issueKey,
  from,
  to,
});

describe('applyPriority', () => {
  it('changes priority and writes a linked evidence audit as the approving user', async () => {
    const evidence = Array.from({ length: 5 }, (_, i) => bulkyEvidence(i));
    const preview = snapshot({
      evidence,
      summary: {
        text: 'Template summary.',
        generated: false,
        citedIds: [evidence[2]!.id, evidence[0]!.id, evidence[3]!.id, evidence[1]!.id],
      },
    });
    const { deps, writer, store } = await setup({ snapshots: [preview] });

    await expect(applyPriority(deps, [change()], 'acc-1')).resolves.toEqual({
      applied: ['PAY-142'],
      failed: [],
    });
    expect(writer.updateIssue).toHaveBeenCalledWith('PAY-142', { priority: 'Highest' });
    expect(deps.jira.canView).toHaveBeenCalledWith('PAY-142');

    const comment = writer.addComment.mock.calls[0]![1];
    const text = JSON.stringify(comment);
    expect(text).toContain('Low → Highest');
    expect(text).toContain('Stakes Score: 89');
    expect(text).toContain('"id":"acc-1"');
    for (const e of [evidence[2]!, evidence[0]!, evidence[3]!]) {
      expect(text).toContain(e.title);
      expect(text).toContain(e.url);
    }
    expect(text).not.toContain(evidence[1]!.title);
    expect(text).not.toContain(evidence[4]!.title);

    expect([...store.rows('audit').values()]).toEqual([
      {
        id: expect.any(String),
        issueKey: 'PAY-142',
        kind: 'priority',
        from: 'Low',
        to: 'Highest',
        score: 89,
        topEvidence: [evidence[2], evidence[0], evidence[3]],
        actorAccountId: 'acc-1',
        at: NOW.toISOString(),
      },
    ]);
  });

  it('rejects a stale preview without writing', async () => {
    const { deps, writer, store } = await setup({ priorities: { 'PAY-142': 'High' } });
    await expect(applyPriority(deps, [change()], 'acc-1')).resolves.toEqual({
      applied: [],
      failed: [{ issueKey: 'PAY-142', code: 'STALE_PREVIEW' }],
    });
    expect(writer.updateIssue).not.toHaveBeenCalled();
    expect(writer.addComment).not.toHaveBeenCalled();
    expect(store.rows('audit').size).toBe(0);
  });

  it('reports a Jira 403 and does not post an audit comment', async () => {
    const { deps, writer, store } = await setup({
      updateError: new JiraError('jira-update-issue', 403),
    });
    await expect(applyPriority(deps, [change()], 'acc-1')).resolves.toEqual({
      applied: [],
      failed: [{ issueKey: 'PAY-142', code: 'FORBIDDEN' }],
    });
    expect(writer.addComment).not.toHaveBeenCalled();
    expect(store.rows('audit').size).toBe(0);
  });

  it('continues a mixed batch after stale and forbidden changes', async () => {
    const previews = ['PAY-1', 'PAY-2', 'PAY-3'].map((issueKey) => snapshot({ issueKey }));
    const { deps, writer } = await setup({
      snapshots: previews,
      priorities: { 'PAY-2': 'High' },
      canView: (issueKey) => issueKey !== 'PAY-3',
    });
    const changes = [change('PAY-1'), change('PAY-2'), change('PAY-3')];
    await expect(applyPriority(deps, changes, 'acc-1')).resolves.toEqual({
      applied: ['PAY-1'],
      failed: [
        { issueKey: 'PAY-2', code: 'STALE_PREVIEW' },
        { issueKey: 'PAY-3', code: 'FORBIDDEN' },
      ],
    });
    expect(writer.updateIssue).toHaveBeenCalledTimes(1);
    expect(writer.updateIssue).toHaveBeenCalledWith('PAY-1', { priority: 'Highest' });
    expect(deps.jira.issue).not.toHaveBeenCalledWith('PAY-3');
  });

  it('rejects a change with no cached score and evidence preview', async () => {
    const { deps, writer } = await setup({ snapshots: [] });
    await expect(applyPriority(deps, [change()], 'acc-1')).resolves.toEqual({
      applied: [],
      failed: [{ issueKey: 'PAY-142', code: 'STALE_PREVIEW' }],
    });
    expect(writer.updateIssue).not.toHaveBeenCalled();
  });
});
