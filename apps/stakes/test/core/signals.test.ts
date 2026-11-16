import { describe, expect, it } from 'vitest';
import { jsmPriorityWeight, rawSignals } from '../../src/core/signals.js';
import { customer, deal, goal, message, request } from './evidence.js';

const now = new Date('2026-11-20T10:00:00Z');

describe('rawSignals', () => {
  it('is all zero with no evidence, and urgency is null', () => {
    expect(rawSignals([], now)).toEqual({ R: 0, S: 0, C: 0, H: 0, G: 0, U: null });
  });

  it('weights open deals by probability and excludes closed deals', () => {
    const r = rawSignals(
      [
        deal('D1', 220_000, 0.6),
        deal('D2', 160_000, 0.9),
        deal('D3', 500_000, 1, { closed: true, closeDate: '2026-11-21' }),
      ],
      now,
    );
    expect(r.R).toBeCloseTo(276_000);
    expect(r.U).toBeNull();
  });

  it('counts a deal reached twice only once', () => {
    expect(rawSignals([deal('D1', 100_000, 0.5), deal('D1', 100_000, 0.5)], now).R).toBe(50_000);
  });

  it('adds the ARR of customers renewing within 90 days, including overdue renewals', () => {
    const r = rawSignals(
      [
        customer('C1', 'enterprise', { arrUsd: 100_000, renewalDate: '2027-02-18' }),
        customer('C2', 'smb', { arrUsd: 7_000, renewalDate: '2027-02-19' }),
        customer('C3', 'smb', { arrUsd: 5_000, renewalDate: '2026-11-01' }),
      ],
      now,
    );
    expect(r.R).toBe(105_000);
  });

  it('dedupes customers and sums tier weights', () => {
    const r = rawSignals(
      [
        customer('C1', 'enterprise'),
        customer('C1', 'enterprise'),
        customer('C2', 'mid-market'),
        customer('C3', 'smb'),
      ],
      now,
    );
    expect(r.C).toBe(6);
  });

  it('adds half a point per 14 days of age and doubles escalations', () => {
    const r = rawSignals(
      [
        request('H-1', 'High', '2026-11-05T09:00:00Z'), // 15 days → 3.5
        request('H-2', 'Low', '2026-10-16T09:00:00Z'), // 35 days → 2
        request('H-3', 'Medium', '2026-11-19T09:00:00Z', { escalated: true }), // 1 day → 2 × 2
      ],
      now,
    );
    expect(r.S).toBe(9.5);
  });

  it.each([
    ['Highest', 4],
    ['Critical', 4],
    ['High', 3],
    ['Major', 3],
    ['Medium', 2],
    ['Something custom', 2],
    ['Low', 1],
    ['Lowest', 1],
  ])('weights JSM priority %s as %i', (priority, weight) => {
    expect(jsmPriorityWeight(priority)).toBe(weight);
  });

  it('counts only messages from the last 30 days', () => {
    const r = rawSignals(
      [
        message('M1', '2026-10-21T09:00:00Z'),
        message('M2', '2026-10-20T09:00:00Z'),
        message('M3', '2026-11-19T09:00:00Z'),
      ],
      now,
    );
    expect(r.H).toBe(2);
  });

  it('takes the highest goal weight', () => {
    expect(rawSignals([goal('G1', 'on-track')], now).G).toBe(1);
    expect(rawSignals([goal('G1', 'on-track'), goal('G2', 'at-risk')], now).G).toBe(1.5);
    expect(rawSignals([goal('G1', 'off-track')], now).G).toBe(1.5);
    expect(rawSignals([goal('G1', 'unknown')], now).G).toBe(1);
  });

  it('uses the nearest close, renewal or SLA date for urgency, with past dates at 0', () => {
    expect(
      rawSignals(
        [
          deal('D1', 1, 1, { closeDate: '2026-12-15' }),
          customer('C1', 'smb', { renewalDate: '2027-03-31' }),
          request('H-1', 'Low', '2026-11-19T00:00:00Z', { slaBreachAt: '2026-12-30T12:00:00Z' }),
        ],
        now,
      ).U,
    ).toBe(25);
    expect(rawSignals([deal('D1', 1, 1, { closeDate: '2026-11-01' })], now).U).toBe(0);
  });
});
