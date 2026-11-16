import { describe, expect, it } from 'vitest';
import { historyChange, sparklinePoints } from '../../src/frontend/history.js';

describe('score history sparkline', () => {
  it('scales scores and days to the SVG view box', () => {
    const points = [
      { date: '2026-11-18', score: 0 },
      { date: '2026-11-19', score: 50 },
      { date: '2026-11-20', score: 100 },
    ];
    expect(sparklinePoints(points, 100, 50)).toBe('0,50 50,25 100,0');
  });

  it('handles empty, single-point and flat series', () => {
    expect(sparklinePoints([])).toBe('');
    expect(sparklinePoints([{ date: '2026-11-20', score: 25 }])).toBe('120,36');
    expect(
      sparklinePoints([
        { date: '2026-11-19', score: 50 },
        { date: '2026-11-20', score: 50 },
      ]),
    ).toBe('0,24 240,24');
  });

  it('calculates the change from the first to last point', () => {
    expect(historyChange([])).toBe(0);
    expect(historyChange([{ date: '2026-11-20', score: 72 }])).toBe(0);
    expect(
      historyChange([
        { date: '2026-11-18', score: 70 },
        { date: '2026-11-19', score: 65 },
        { date: '2026-11-20', score: 72 },
      ]),
    ).toBe(2);
  });
});
