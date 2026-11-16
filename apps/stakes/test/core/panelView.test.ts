import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@stakes/contracts';
import { normalise } from '../../src/core/normalise.js';
import {
  buildTiles,
  templateSummary,
  toPanelView,
  topCustomers,
} from '../../src/core/panelView.js';
import { DEFAULT_WEIGHTS, score } from '../../src/core/score.js';
import { rawSignals } from '../../src/core/signals.js';
import { snapshot } from '../fakes/snapshot.js';
import { customer, deal, goal, message, request } from './evidence.js';

const now = new Date('2026-11-20T10:00:00Z');
const p95 = { R: 450000, S: 18, C: 9, H: 10 };

function scored(evidence: Snapshot['evidence']): Snapshot {
  const raw = rawSignals(evidence, now);
  const result = score(normalise(raw, p95, 25), DEFAULT_WEIGHTS);
  return snapshot({ evidence, raw, contributions: result.contributions, score: result.score });
}

const pay142 = () =>
  scored([
    deal('DEAL-031', 220000, 0.6, { customerId: 'CUST-007', closeDate: '2026-12-15' }),
    deal('DEAL-034', 160000, 0.9, { customerId: 'CUST-012', closeDate: '2027-01-20' }),
    deal('DEAL-036', 100000, 0.4, { customerId: 'CUST-015', closeDate: '2027-02-10' }),
    customer('CUST-007', 'enterprise', { renewalDate: '2027-03-31' }),
    customer('CUST-012', 'enterprise', { renewalDate: '2027-06-30' }),
    customer('CUST-015', 'mid-market', { renewalDate: '2027-04-15' }),
    request('HELP-1', 'High', '2026-11-05T09:00:00Z'),
    request('HELP-2', 'Medium', '2026-11-19T09:00:00Z', { escalated: true }),
    message('M1', '2026-11-19T09:00:00Z'),
    goal('G1', 'on-track'),
  ]);

describe('buildTiles', () => {
  it('builds six tiles sorted by points, each with its sources', () => {
    const tiles = buildTiles(pay142(), now);
    expect(tiles.map((t) => t.signal)).toEqual(['R', 'S', 'C', 'U', 'G', 'H']);
    const byKey = Object.fromEntries(tiles.map((t) => [t.signal, t]));
    expect(byKey.R).toMatchObject({
      label: 'Revenue at risk',
      rawDisplay: 'US$480K · 3 deals',
      detail: 'US$316K weighted by stage',
      evidenceIds: ['ev-deal-DEAL-031', 'ev-deal-DEAL-034', 'ev-deal-DEAL-036'],
    });
    expect(byKey.C).toMatchObject({
      rawDisplay: '8 pts · 3 customers',
      detail: '2 Enterprise, 1 Mid-market',
    });
    expect(byKey.S).toMatchObject({ rawDisplay: '7.5 · 2 requests', detail: '1 escalated' });
    expect(byKey.H).toMatchObject({ rawDisplay: '1 message', detail: 'Last 30 days' });
    expect(byKey.G).toMatchObject({ rawDisplay: '1 goal', detail: 'G1, on track' });
    expect(byKey.U).toMatchObject({ rawDisplay: '25 days', detail: 'DEAL-031 closes 15 Dec 2026' });
    expect(byKey.U!.evidenceIds[0]).toBe('ev-deal-DEAL-031');
  });

  it('describes empty tiles plainly', () => {
    const tiles = Object.fromEntries(buildTiles(scored([]), now).map((t) => [t.signal, t]));
    expect(tiles.R).toMatchObject({
      rawDisplay: 'No open deals',
      detail: 'Nothing weighted yet',
      points: 0,
    });
    expect(tiles.S!.rawDisplay).toBe('No open requests');
    expect(tiles.C!.rawDisplay).toBe('No customers');
    expect(tiles.G!.detail).toBe('Not linked to a goal');
    expect(tiles.U).toMatchObject({
      rawDisplay: 'No dates',
      detail: 'No close, renewal or SLA dates',
    });
  });

  it('counts renewals within 90 days into revenue', () => {
    const s = scored([customer('C1', 'smb', { arrUsd: 50000, renewalDate: '2027-01-10' })]);
    const r = buildTiles(s, now).find((t) => t.signal === 'R')!;
    expect(r).toMatchObject({ rawDisplay: 'US$50K renewing', evidenceIds: ['ev-customer-C1'] });
    expect(r.detail).toBe('US$50K weighted by stage, 1 renewal within 90 days');
  });

  it('words past renewals and closes in the past tense', () => {
    const renew = scored([customer('C1', 'smb', { renewalDate: '2026-11-01' })]);
    expect(buildTiles(renew, now).find((t) => t.signal === 'U')!.detail).toBe(
      'C1 was due to renew 1 Nov 2026',
    );
    const close = scored([deal('D1', 1, 1, { closeDate: '2026-11-02' })]);
    expect(buildTiles(close, now).find((t) => t.signal === 'U')!.detail).toBe(
      'D1 was due to close 2 Nov 2026',
    );
  });

  it('names an at-risk goal and a passed SLA', () => {
    const s = scored([
      goal('Faster exports', 'at-risk'),
      request('H-9', 'Low', '2026-11-01T00:00:00Z', { slaBreachAt: '2026-11-18T00:00:00Z' }),
    ]);
    const tiles = Object.fromEntries(buildTiles(s, now).map((t) => [t.signal, t]));
    expect(tiles.G!.detail).toBe('Faster exports, at risk');
    expect(tiles.U).toMatchObject({ rawDisplay: '0 days', detail: 'H-9 SLA breached 18 Nov 2026' });
  });
});

describe('topCustomers', () => {
  it('ranks by open deal value, then tier, and keeps five', () => {
    const evidence = [
      deal('D1', 100, 1, { customerId: 'A' }),
      deal('D2', 900, 1, { customerId: 'B', closeDate: '2027-01-01' }),
      deal('D3', 5000, 1, { customerId: 'B', closed: true }),
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) =>
        customer(id, i === 2 ? 'enterprise' : 'smb', { renewalDate: '2027-05-01' }),
      ),
    ];
    const top = topCustomers(evidence);
    expect(top.map((c) => c.id)).toEqual(['B', 'A', 'C', 'D', 'E']);
    expect(top[0]).toMatchObject({ dealValueUsd: 900, date: '2027-01-01' });
    expect(top[2]).toMatchObject({ dealValueUsd: 0, date: '2027-05-01' });
  });
});

describe('templateSummary', () => {
  it('names the three biggest signals and cites their evidence', () => {
    const s = pay142();
    const summary = templateSummary(s, now);
    expect(summary.text).toBe(
      'Most of this score comes from US$316K of weighted revenue across 3 open deals, 2 open support requests (1 escalated) and 3 linked customers.',
    );
    expect(summary.citedIds).toContain('ev-deal-DEAL-031');
    expect(summary.citedIds).toContain('ev-escalation-HELP-2');
  });

  it('says so when nothing carries stakes', () => {
    expect(templateSummary(scored([]), now)).toEqual({
      text: 'Nothing linked to this issue carries stakes yet.',
      citedIds: [],
    });
  });

  it('handles a single signal and the other phrasings', () => {
    expect(templateSummary(scored([goal('G', 'at-risk')]), now).text).toBe(
      'Most of this score comes from a linked goal that is at risk.',
    );
    const s = scored([
      message('M1', '2026-11-19T00:00:00Z'),
      goal('G', 'on-track'),
      customer('C1', 'smb', { arrUsd: 10000, renewalDate: '2026-11-20' }),
    ]);
    expect(templateSummary(s, now).text).toBe(
      'Most of this score comes from US$10K of renewals due within 90 days, a date that is due now and a linked company goal.',
    );
  });
});

describe('toPanelView', () => {
  it('carries everything the panel shows', () => {
    const s = { ...pay142(), hiddenItems: 1, degraded: ['teamwork-graph' as const] };
    const view = toPanelView(s, now);
    expect(view).toMatchObject({
      issueKey: 'PAY-142',
      currentPriority: 'Low',
      suggestedPriority: 'Highest',
      badges: ['silent-fire'],
      summary: { sourceCount: 10, generated: false },
      hiddenItems: 1,
      degraded: ['teamwork-graph'],
      hasPendingShipNotice: false,
    });
    expect(view.customers.map((c) => c.id)).toEqual(['CUST-007', 'CUST-012', 'CUST-015']);
    expect(view.evidence).toHaveLength(10);
  });
});
