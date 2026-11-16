import { describe, expect, it } from 'vitest';
import type { PanelView } from '@stakes/contracts';
import {
  evidenceValue,
  formatPoints,
  formatTile,
  groupEvidence,
  panelNotices,
  relativeTime,
  suggestionText,
} from '../../src/frontend/format.js';
import { customer, deal, goal, message, request } from '../core/evidence.js';

const evidence = [
  deal('D1', 220000, 0.6),
  customer('C1', 'enterprise'),
  request('H-1', 'High', '2026-11-05T00:00:00Z'),
  request('H-2', 'Low', '2026-11-05T00:00:00Z', { escalated: true }),
  message('M1', '2026-11-19T00:00:00Z'),
  goal('G1', 'on-track'),
];

describe('panel formatting', () => {
  it('rounds points for display', () => {
    expect(formatPoints(34.05)).toBe('+34 pts');
    expect(formatPoints(6.67)).toBe('+7 pts');
    expect(formatPoints(0.4)).toBe('+0 pts');
    expect(formatPoints(-1)).toBe('+0 pts');
  });

  it('formats a tile with its value, detail and source count', () => {
    const view = {
      tiles: [
        {
          signal: 'R' as const,
          label: 'Revenue at risk',
          rawDisplay: 'US$480K · 3 deals',
          detail: 'US$316K weighted by stage',
          points: 34.05,
          evidenceIds: ['a', 'b', 'c'],
        },
      ],
    };
    expect(formatTile(view, 'R')).toEqual({
      label: 'Revenue at risk',
      value: 'US$480K · 3 deals',
      detail: 'US$316K weighted by stage',
      points: '+34 pts',
      evidenceCount: 3,
    });
    expect(formatTile(view, 'S')).toBeNull();
  });

  it('words the suggestion, a match and a missing mapping', () => {
    expect(suggestionText({ suggestedPriority: 'Highest', currentPriority: 'Low' })).toBe(
      'Suggested: Highest (now Low)',
    );
    expect(suggestionText({ suggestedPriority: 'High', currentPriority: 'high' })).toBe(
      'Priority already matches the score (high).',
    );
    expect(suggestionText({ suggestedPriority: null, currentPriority: 'Low' })).toMatch(
      /map this band/,
    );
  });

  it('shows how long ago the score was computed', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(relativeTime('2026-11-20T09:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-20T09:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-11-20T08:00:00Z', now)).toBe('2 h ago');
    expect(relativeTime('2026-11-17T10:00:00Z', now)).toBe('3 d ago');
    expect(relativeTime('nope', now)).toBe('');
  });

  it('groups evidence by kind, escalations first, and filters to a tile', () => {
    expect(groupEvidence(evidence).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Deals', ['ev-deal-D1']],
      ['Customers', ['ev-customer-C1']],
      ['Support requests', ['ev-escalation-H-2', 'ev-jsm_request-H-1']],
      ['Conversations', ['ev-conversation-M1']],
      ['Goals', ['ev-goal-G1']],
    ]);
    expect(groupEvidence(evidence, ['ev-deal-D1']).map((g) => g.label)).toEqual(['Deals']);
  });

  it('formats each evidence value with its unit', () => {
    expect(evidenceValue({ ...evidence[0]!, value: 220000, unit: 'USD' })).toBe('US$220K');
    expect(evidenceValue({ ...evidence[1]!, value: 3 })).toBe('3 pts');
    expect(evidenceValue({ ...evidence[2]!, value: 3.5 })).toBe('3.5');
    expect(evidenceValue({ ...evidence[4]!, value: 1, unit: 'count' })).toBe('1');
    expect(evidenceValue({ ...evidence[5]!, value: null })).toBe('');
  });

  it('lists notices for degraded sources, hidden items and thin evidence', () => {
    const base: Pick<PanelView, 'confidence' | 'degraded' | 'hiddenItems' | 'evidence'> = {
      confidence: 'high',
      degraded: [],
      hiddenItems: 0,
      evidence,
    };
    expect(panelNotices(base)).toEqual([]);
    expect(
      panelNotices({
        ...base,
        degraded: ['teamwork-graph', 'jira-rest'],
        hiddenItems: 2,
        confidence: 'low',
      }).map((n) => n.text),
    ).toEqual([
      'Teamwork Graph signals unavailable. The score uses the other sources.',
      'Linked support requests could not be read just now.',
      "You don't have access to some linked items, so they aren't counted.",
      'Based on limited evidence.',
    ]);
    expect(panelNotices({ ...base, confidence: 'low', evidence: [] })).toEqual([]);
  });
});
