import { describe, expect, it } from 'vitest';
import {
  conversationEvidence,
  customerEvidence,
  dealEvidence,
  goalEvidence,
  probabilityForStage,
  requestEvidence,
} from '../../src/core/evidence';
import { canonicalEvidence } from '../../src/core/evidenceHash';

const at = '2026-11-20T10:00:00.000Z';
const now = new Date(at);

describe('evidence builders', () => {
  it('builds a deal item with a stable id and its facts', () => {
    const item = dealEvidence(
      {
        id: 'DEAL-031',
        name: 'Expansion',
        customerId: 'C1',
        customerName: 'Kilima',
        amountUsd: 220000,
        probability: 0.6,
        stage: 'Negotiation',
        closeDate: '2026-12-15',
        closed: false,
        ownerAccountId: 'o1',
        url: 'u',
      },
      'mirror',
      at,
    );
    expect(item).toMatchObject({
      id: 'ev-deal-DEAL-031',
      type: 'deal',
      title: 'Kilima · Expansion',
      value: 220000,
      unit: 'USD',
      signal: 'R',
      source: 'mirror',
      fetchedAt: at,
    });
    expect(item.detail).toBe('DEAL-031 · Negotiation, 60% · closes 15 Dec 2026');
    const closed = dealEvidence(
      {
        ...item.facts,
        id: 'D2',
        name: 'Old',
        customerName: null,
        closed: true,
        closeDate: null,
        url: 'u',
      } as never,
      'mirror',
      at,
    );
    expect(closed).toMatchObject({ title: 'Old', detail: 'D2 · Negotiation (closed)' });
  });

  it('builds a customer item worth its tier weight', () => {
    expect(
      customerEvidence(
        {
          id: 'C1',
          name: 'Kilima',
          tier: 'enterprise',
          arrUsd: 420000,
          renewalDate: '2027-03-31',
          ownerAccountId: null,
          url: 'u',
        },
        'mirror',
        at,
      ),
    ).toMatchObject({
      id: 'ev-customer-C1',
      value: 3,
      detail: 'C1 · Enterprise · US$420K ARR · renews 31 Mar 2027',
    });
    expect(
      customerEvidence(
        {
          id: 'C2',
          name: 'Tiny',
          tier: 'smb',
          arrUsd: 0,
          renewalDate: null,
          ownerAccountId: null,
          url: 'u',
        },
        'bridge',
        at,
      ).detail,
    ).toBe('C2 · SMB');
  });

  it('builds request and escalation items valued at their pressure', () => {
    const base = {
      key: 'HELP-1',
      summary: 'Export fails',
      priority: 'High',
      createdAt: '2026-11-05T09:00:00Z',
      slaBreachAt: null,
      assigneeAccountId: null,
      url: 'u',
    };
    expect(requestEvidence({ ...base, escalated: false }, now, at)).toMatchObject({
      id: 'ev-jsm_request-HELP-1',
      type: 'jsm_request',
      title: 'HELP-1 · Export fails',
      value: 3.5,
      detail: 'High · open 15 days',
      source: 'jira-rest',
    });
    expect(
      requestEvidence({ ...base, createdAt: '2026-11-19T09:00:00Z', escalated: true }, now, at),
    ).toMatchObject({
      id: 'ev-escalation-HELP-1',
      type: 'escalation',
      value: 6,
      detail: 'High · open 1 day · escalated',
    });
  });

  it('builds conversation and goal items', () => {
    expect(
      conversationEvidence(
        { id: 'M1', channel: '#cs', author: 'Ann', text: 'ETA?', at, url: 'u' },
        'mirror',
        at,
      ),
    ).toMatchObject({ title: '#cs · Ann', detail: 'ETA?', value: 1, unit: 'count' });
    expect(
      conversationEvidence(
        { id: 'M2', channel: null, author: null, text: '', at, url: 'u' },
        'teamwork-graph',
        at,
      ).title,
    ).toBe('Conversation');
    expect(
      goalEvidence({ id: 'g', name: 'Churn', status: 'off-track', url: 'u' }, at),
    ).toMatchObject({ value: 1.5, detail: 'Off track', source: 'teamwork-graph' });
  });

  it.each([
    ['Discovery', 0.1],
    ['Qualification', 0.2],
    ['Proposal', 0.4],
    ['Negotiation', 0.6],
    ['Commit', 0.9],
    ['Closed Won', 1],
    ['Closed lost', 0],
    ['Something else', 0.5],
  ])('defaults %s to probability %d', (stage, p) => {
    expect(probabilityForStage(stage)).toBe(p);
  });
});

describe('canonicalEvidence', () => {
  it('sorts by id, drops fetch time and fixes key order', () => {
    const a = goalEvidence({ id: 'b', name: 'B', status: 'on-track', url: 'u' }, at);
    const b = goalEvidence(
      { id: 'a', name: 'A', status: 'on-track', url: 'u' },
      '2030-01-01T00:00:00.000Z',
    );
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(canonicalEvidence([a, b])).toBe(canonicalEvidence([b, reordered]));
    expect(canonicalEvidence([a])).not.toContain('fetchedAt');
  });
});
