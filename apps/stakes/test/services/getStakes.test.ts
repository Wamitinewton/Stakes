import { describe, expect, it, vi } from 'vitest';
import { evidenceHash, getPanelView, getStakes, isFresh } from '../../src/services/getStakes.js';
import { snapshot } from '../fakes/snapshot.js';
import {
  fakeStakesDeps,
  issueDetails,
  linkedRequest,
  mirrorCustomer,
  mirrorDeal,
  NOW,
} from '../fakes/deps.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

async function withEvidence() {
  const f = fakeStakesDeps({ requests: [linkedRequest('HELP-1', { priority: 'High' })] });
  await f.mirror.upsertCustomers([mirrorCustomer('C1', 'enterprise')]);
  await f.mirror.upsertDeals([mirrorDeal('D1', 'C1', 220000, 0.6)]);
  return f;
}

describe('isFresh', () => {
  const s = snapshot({
    computedAt: '2026-11-20T08:00:00.000Z',
    dealsVersion: 3,
    weightsVersion: 2,
  });
  const current = { issueUpdated: '2026-11-20T07:00:00.000Z', dealsVersion: 3, weightsVersion: 2 };

  it('accepts a recent snapshot when nothing changed', () => {
    expect(isFresh(s, NOW, current)).toBe(true);
  });

  it.each([
    ['six hours old', new Date('2026-11-20T14:00:00.000Z'), current],
    ['issue edited after it', NOW, { ...current, issueUpdated: '2026-11-20T08:00:01.000Z' }],
    ['deals re-imported', NOW, { ...current, dealsVersion: 4 }],
    ['weights changed', NOW, { ...current, weightsVersion: 3 }],
  ])('rejects it when %s', (_label, now, cur) => {
    expect(isFresh(s, now, cur)).toBe(false);
  });
});

describe('getStakes', () => {
  it('computes, saves the snapshot and records today in history', async () => {
    const f = await withEvidence();
    const result = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.data;
    expect(s).toMatchObject({
      issueKey: 'PAY-142',
      projectKey: 'PAY',
      currentPriority: 'Low',
      weightsVersion: 1,
      dealsVersion: 0,
      // The fake graph fails its conversation query and the mirror has no messages.
      degraded: ['teamwork-graph'],
      computedAt: NOW.toISOString(),
      summary: { generated: false },
    });
    expect(s.evidence.every((e) => e.source)).toBe(true);
    expect(s.score).toBeGreaterThan(0);
    expect(s.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await f.deps.snapshots.latest('PAY-142'))?.score).toBe(s.score);
    expect(await f.deps.history.scoreOnOrBefore('PAY-142', '2026-11-20')).toBe(s.score);
    expect(f.scoreField.set).toHaveBeenCalledWith('PAY-142', s.score);
  });

  it('returns a fresh snapshot without any graph call', async () => {
    const f = await withEvidence();
    const first = await getStakes(f.deps, 'PAY-142', { refresh: false });
    vi.clearAllMocks();
    const second = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(second).toEqual(first);
    expect(f.graph.dealsForIssue).not.toHaveBeenCalled();
    expect(f.graph.goalsForIssue).not.toHaveBeenCalled();
    expect(f.graph.conversationsForIssue).not.toHaveBeenCalled();
    expect(f.jira.linkedRequests).not.toHaveBeenCalled();
  });

  it('recomputes on refresh, after a re-import and after a weight change', async () => {
    const f = await withEvidence();
    await getStakes(f.deps, 'PAY-142', { refresh: false });

    vi.clearAllMocks();
    await getStakes(f.deps, 'PAY-142', { refresh: true });
    expect(f.graph.dealsForIssue).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    await f.mirror.bumpDealsVersion();
    const reimported = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(f.graph.dealsForIssue).toHaveBeenCalledTimes(1);
    expect(reimported.ok && reimported.data.dealsVersion).toBe(1);

    vi.clearAllMocks();
    const settings = await f.settings.get();
    await f.settings.save({
      ...settings,
      weights: { R: 1, S: 0, C: 0, H: 0, G: 0, U: 0 },
      weightsVersion: 2,
    });
    const reweighted = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(f.graph.dealsForIssue).toHaveBeenCalledTimes(1);
    expect(reweighted.ok && reweighted.data.weightsVersion).toBe(2);
  });

  it('uses stored percentiles once enough issues are scored, and floors before that', async () => {
    const f = await withEvidence();
    const floors = await getStakes(f.deps, 'PAY-142', { refresh: true });
    await f.store.kvs.set('percentiles:PAY', {
      R: 450000,
      S: 18,
      C: 9,
      H: 10,
      scoredCount: 25,
      at: 'x',
      seeded: true,
    });
    const scaled = await getStakes(f.deps, 'PAY-142', { refresh: true });
    expect(floors.ok && scaled.ok && floors.data.normalised.R > scaled.data.normalised.R).toBe(
      true,
    );
  });

  it('flags a silent fire and a stakes jump from history', async () => {
    const f = await withEvidence();
    await f.store.kvs.set('percentiles:PAY', {
      R: 100000,
      S: 5,
      C: 3,
      H: 5,
      scoredCount: 25,
      at: 'x',
      seeded: true,
    });
    await f.deps.history.record({
      issueKey: 'PAY-142',
      projectKey: 'PAY',
      day: '2026-11-12',
      score: 10,
      badges: [],
      source: 'demo',
    });
    const result = await getStakes(f.deps, 'PAY-142', { refresh: true });
    expect(result.ok && result.data.badges).toEqual(['silent-fire', 'stakes-jump']);
    expect(result.ok && result.data.suggestedPriority).toBe('High');
  });

  it('scores an issue with no evidence at 0, with a phantom badge on a high priority', async () => {
    const f = fakeStakesDeps({ issue: issueDetails({ key: 'PAY-150', priority: 'Highest' }) });
    const result = await getStakes(f.deps, 'PAY-150', { refresh: false });
    expect(result).toMatchObject({
      ok: true,
      data: {
        score: 0,
        badges: ['phantom'],
        suggestedPriority: 'Lowest',
        confidence: 'low',
        degraded: ['teamwork-graph'],
      },
    });
    expect(f.scoreField.set).toHaveBeenCalledWith('PAY-150', 0);
  });

  it('answers NOT_FOUND for an issue the reader cannot see', async () => {
    const f = fakeStakesDeps({ issue: null });
    expect(await getStakes(f.deps, 'PAY-1', { refresh: false })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('still answers when saving the snapshot fails', async () => {
    const f = await withEvidence();
    f.deps.snapshots.save = vi.fn().mockRejectedValue(new Error('storage down'));
    const result = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(result.ok).toBe(true);
  });

  it('still answers when the custom field update fails', async () => {
    const f = await withEvidence();
    f.deps.scoreField.set = vi.fn().mockRejectedValue(new Error('field unavailable'));
    const result = await getStakes(f.deps, 'PAY-142', { refresh: false });
    expect(result.ok).toBe(true);
    expect((await f.deps.snapshots.latest('PAY-142'))?.issueKey).toBe('PAY-142');
  });

  it('maps the snapshot to a panel view', async () => {
    const f = await withEvidence();
    const view = await getPanelView(f.deps, 'PAY-142', { refresh: false });
    expect(view.ok && view.data.tiles).toHaveLength(6);
    expect(view.ok && view.data.customers.map((c) => c.id)).toEqual(['C1']);
  });
});

describe('evidenceHash', () => {
  it('ignores fetch time and order but not content', async () => {
    const f = await withEvidence();
    const r = await getStakes(f.deps, 'PAY-142', { refresh: false });
    if (!r.ok) throw new Error('no snapshot');
    const ev = r.data.evidence;
    const later = ev.map((e) => ({ ...e, fetchedAt: '2030-01-01T00:00:00.000Z' })).reverse();
    expect(evidenceHash(later)).toBe(evidenceHash(ev));
    expect(evidenceHash([{ ...ev[0]!, value: 1 }, ...ev.slice(1)])).not.toBe(evidenceHash(ev));
  });
});

describe('getStakes summary', () => {
  const generated = (f: Awaited<ReturnType<typeof withEvidence>>) =>
    f.writer.write.mockImplementation(async (req) => ({
      text: `Generated for ${req.context.issueKey} [${req.evidence[0]!.id}].`,
      citedIds: [req.evidence[0]!.id],
      generated: true,
    }));

  it('keeps the template and never calls the writer unless asked to explain', async () => {
    const f = await withEvidence();
    const r = await getStakes(f.deps, 'PAY-142', { refresh: true });
    expect(r.ok && r.data.summary.generated).toBe(false);
    expect(f.writer.write).not.toHaveBeenCalled();
  });

  it('asks the writer for a summary keyed by the evidence hash, with the template as fallback', async () => {
    const f = await withEvidence();
    generated(f);
    const r = await getStakes(f.deps, 'PAY-142', { refresh: true, explain: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = f.writer.write.mock.calls[0]![0];
    expect(req).toMatchObject({
      purpose: 'summary',
      cacheKey: `${r.data.evidenceHash}:summary`,
      context: { issueKey: 'PAY-142', issueSummary: 'CSV export times out above 10k rows' },
      fallback: { text: expect.stringMatching(/^Most of this score comes from/) },
    });
    expect(r.data.summary).toMatchObject({
      generated: true,
      text: 'Generated for PAY-142 [ev-deal-D1].',
    });
    expect((await f.deps.snapshots.latest('PAY-142'))!.summary.generated).toBe(true);
  });

  it('upgrades a fresh template snapshot once, when the panel opens it with the LLM on', async () => {
    const f = await withEvidence();
    await getStakes(f.deps, 'PAY-142', { refresh: false });
    await f.settings.save({ ...(await f.settings.get()), llmEnabled: true });
    generated(f);
    const r = await getStakes(f.deps, 'PAY-142', { refresh: false, explain: true });
    expect(r.ok && r.data.summary.generated).toBe(true);
    expect(f.graph.dealsForIssue).toHaveBeenCalledTimes(1);
    expect((await f.deps.snapshots.latest('PAY-142'))!.summary.generated).toBe(true);
    f.writer.write.mockClear();
    await getStakes(f.deps, 'PAY-142', { refresh: false, explain: true });
    expect(f.writer.write).not.toHaveBeenCalled();
  });

  it('does not try to upgrade while the LLM is off', async () => {
    const f = await withEvidence();
    await getStakes(f.deps, 'PAY-142', { refresh: false });
    await getStakes(f.deps, 'PAY-142', { refresh: false, explain: true });
    expect(f.writer.write).not.toHaveBeenCalled();
  });

  it('keeps the template when the writer throws', async () => {
    const f = await withEvidence();
    f.writer.write.mockRejectedValue(new Error('down'));
    const r = await getStakes(f.deps, 'PAY-142', { refresh: true, explain: true });
    expect(r.ok && r.data.summary).toMatchObject({
      generated: false,
      text: expect.stringMatching(/^Most/),
    });
  });

  it('skips the model when nothing is linked', async () => {
    const f = fakeStakesDeps();
    await getStakes(f.deps, 'PAY-142', { refresh: true, explain: true });
    expect(f.writer.write).not.toHaveBeenCalled();
  });

  it('shows "generated from" the cited sources in the panel view', async () => {
    const f = await withEvidence();
    generated(f);
    const r = await getPanelView(f.deps, 'PAY-142', { refresh: true });
    expect(r.ok && r.data.summary).toEqual({
      text: 'Generated for PAY-142 [ev-deal-D1].',
      generated: true,
      sourceCount: 1,
      citedIds: ['ev-deal-D1'],
    });
  });
});
