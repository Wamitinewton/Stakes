import { describe, expect, it, vi } from 'vitest';
import { collectEvidence } from '../../src/services/collect';
import { fakeStakesDeps, linkedRequest, mirrorCustomer, mirrorDeal, SITE } from '../fakes/deps';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'warn').mockImplementation(() => {});

const issue = { key: 'PAY-142', id: '10042' };

async function seededMirror() {
  const f = fakeStakesDeps({
    requests: [linkedRequest('HELP-1'), linkedRequest('HELP-2', { escalated: true })],
  });
  await f.mirror.upsertCustomers([mirrorCustomer('C1', 'enterprise'), mirrorCustomer('C2', 'smb')]);
  await f.mirror.upsertDeals([mirrorDeal('D1', 'C1', 220000, 0.6)]);
  await f.mirror.linkCustomers([{ customerId: 'C2', issueKey: 'PAY-142', source: 'demo' }]);
  await f.mirror.upsertMessages([
    {
      id: 'M1',
      issueKey: 'PAY-142',
      channel: '#cs',
      author: 'Ann',
      text: 'ETA?',
      at: '2026-11-19T08:00:00Z',
      url: 'u',
      source: 'demo',
    },
  ]);
  return f;
}

describe('collectEvidence', () => {
  it('falls back to the mirror for deals when the graph has none, without marking it degraded', async () => {
    const f = await seededMirror();
    f.graph.conversationsForIssue.mockResolvedValue({
      ok: false,
      degraded: true,
      reason: 'partial-errors',
    });
    const result = await collectEvidence(f.deps, issue);
    expect(result.dealSource).toBe('mirror');
    expect(result.degraded).toEqual([]);
    expect(result.evidence.map((e) => e.id).sort()).toEqual([
      'ev-conversation-M1',
      'ev-customer-C1',
      'ev-customer-C2',
      'ev-deal-D1',
      'ev-escalation-HELP-2',
      'ev-jsm_request-HELP-1',
    ]);
    const deal = result.evidence.find((e) => e.id === 'ev-deal-D1')!;
    expect(deal).toMatchObject({
      title: 'Customer C1 · Deal D1',
      source: 'mirror',
      url: `${SITE}/jira/apps/stakes/deal/D1`,
      detail: 'D1 · Negotiation, 60% · closes 15 Dec 2026',
      fetchedAt: '2026-11-20T10:00:00.000Z',
    });
  });

  it('uses graph deals first, taking probability and customer from the mirror', async () => {
    const f = await seededMirror();
    f.graph.dealsForIssue.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'D1',
          name: 'Expansion',
          amountUsd: 250000,
          stage: 'Negotiation',
          closed: false,
          closeDate: '2026-12-20',
          accountName: 'C1 Inc',
          url: 'https://graph/D1',
        },
        {
          id: 'G9',
          name: 'Graph only',
          amountUsd: 10000,
          stage: 'Proposal',
          closed: false,
          closeDate: null,
          accountName: null,
          url: '',
        },
      ],
    });
    const result = await collectEvidence(f.deps, issue);
    expect(result.dealSource).toBe('teamwork-graph');
    const deals = result.evidence.filter((e) => e.type === 'deal');
    expect(
      deals.map((d) => [d.id, d.source, d.facts.kind === 'deal' && d.facts.probability]),
    ).toEqual([
      ['ev-deal-D1', 'teamwork-graph', 0.6],
      ['ev-deal-G9', 'teamwork-graph', 0.4],
    ]);
    expect(result.evidence.some((e) => e.id === 'ev-customer-C1')).toBe(true);
  });

  it('uses the bridge property when the graph has no deals', async () => {
    const f = fakeStakesDeps({
      bridge: {
        syncedAt: '2026-11-20T07:00:00.000Z',
        deals: [
          {
            id: 'HS-1',
            name: 'Renewal',
            amountUsd: 50000,
            stage: 'Contract sent',
            probability: 0.8,
            closeDate: '2026-12-01',
            ownerAccountId: 'o1',
            customer: { id: 'HC-1', name: 'Hub Co', tier: 'mid-market' },
          },
          {
            id: 'HS-2',
            name: 'Upsell',
            amountUsd: 5000,
            stage: 'Closed won',
            probability: 1,
            closeDate: null,
            ownerAccountId: 'o1',
            customer: { id: 'HC-1', name: 'Hub Co', tier: 'mid-market' },
          },
        ],
      },
    });
    const result = await collectEvidence(f.deps, issue);
    expect(result.dealSource).toBe('bridge');
    expect(result.evidence.filter((e) => e.source === 'bridge').map((e) => e.id)).toEqual([
      'ev-deal-HS-1',
      'ev-deal-HS-2',
      'ev-customer-HC-1',
    ]);
    const closed = result.evidence.find((e) => e.id === 'ev-deal-HS-2')!;
    expect(closed.facts.kind === 'deal' && closed.facts.closed).toBe(true);
  });

  it('marks the graph degraded when it fails and nothing else could answer', async () => {
    const f = fakeStakesDeps();
    f.graph.goalsForIssue.mockResolvedValue({ ok: false, degraded: true, reason: 'http-error' });
    const result = await collectEvidence(f.deps, issue);
    expect(result.evidence).toEqual([]);
    expect(result.degraded).toEqual(['teamwork-graph']);
    expect(result.dealSource).toBeNull();
  });

  it('records a failed Jira read as degraded and keeps the rest', async () => {
    const f = await seededMirror();
    f.jira.linkedRequests.mockRejectedValue(new Error('boom'));
    const result = await collectEvidence(f.deps, issue);
    expect(result.degraded).toContain('jira-rest');
    expect(result.evidence.some((e) => e.type === 'deal')).toBe(true);
  });

  it('passes hidden linked items through and adds goals from the graph', async () => {
    const f = fakeStakesDeps({ hidden: 2 });
    f.graph.goalsForIssue.mockResolvedValue({
      ok: true,
      data: [{ id: 'g1', name: 'Reduce enterprise churn', status: 'at-risk', url: 'https://goal' }],
    });
    const result = await collectEvidence(f.deps, issue);
    expect(result.hiddenItems).toBe(2);
    expect(result.evidence).toMatchObject([{ id: 'ev-goal-g1', value: 1.5, detail: 'At risk' }]);
  });

  it('omits all request evidence when any linked request details are hidden', async () => {
    const f = fakeStakesDeps({ requests: [linkedRequest('HELP-1')], hidden: 1 });
    const result = await collectEvidence(f.deps, issue);
    expect(result.hiddenItems).toBe(1);
    expect(result.evidence.some((e) => e.facts.kind === 'request')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('HELP-1');
  });

  it('reads every source at the same time, at most three graph queries', async () => {
    const f = await seededMirror();
    await collectEvidence(f.deps, issue);
    expect(f.graph.dealsForIssue).toHaveBeenCalledTimes(1);
    expect(f.graph.conversationsForIssue).toHaveBeenCalledWith(issue, 30);
    expect(f.graph.goalsForIssue).toHaveBeenCalledTimes(1);
    expect(f.graph.teamForIssue).not.toHaveBeenCalled();
  });
});
