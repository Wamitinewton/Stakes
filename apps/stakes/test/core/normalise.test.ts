import { describe, expect, it } from 'vitest';
import { FLOORS, effectiveCeilings, normalise } from '../../src/core/normalise';

const zero = { R: 0, S: 0, C: 0, H: 0, G: 0, U: null };
const p95 = { R: 450_000, S: 18, C: 9, H: 10 };

describe('normalise', () => {
  it('maps zero evidence to zero', () => {
    expect(normalise(zero, p95, 25)).toEqual({ R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 });
  });

  it.each(['R', 'S', 'C', 'H'] as const)('%s reaches 1 at its ceiling and clamps above it', (k) => {
    expect(normalise({ ...zero, [k]: p95[k] }, p95, 25)[k]).toBeCloseTo(1);
    expect(normalise({ ...zero, [k]: p95[k] * 10 }, p95, 25)[k]).toBe(1);
  });

  it.each(['R', 'S', 'C', 'H'] as const)('%s reaches 1 at its floor when floors apply', (k) => {
    expect(normalise({ ...zero, [k]: FLOORS[k] }, null, 0)[k]).toBeCloseTo(1);
  });

  it('uses floors when fewer than 10 issues are scored', () => {
    expect(effectiveCeilings(p95, 9)).toEqual(FLOORS);
    expect(effectiveCeilings(p95, 10)).toEqual(p95);
  });

  it('never lets a percentile drop below its floor', () => {
    expect(effectiveCeilings({ R: 10, S: 1, C: 1, H: 1 }, 50)).toEqual(FLOORS);
  });

  it('scales goals by 1.5 and urgency linearly over 90 days', () => {
    expect(normalise({ ...zero, G: 1 }, p95, 25).G).toBeCloseTo(0.667, 3);
    expect(normalise({ ...zero, G: 1.5 }, p95, 25).G).toBe(1);
    expect(normalise({ ...zero, U: 0 }, p95, 25).U).toBe(1);
    expect(normalise({ ...zero, U: 45 }, p95, 25).U).toBe(0.5);
    expect(normalise({ ...zero, U: 90 }, p95, 25).U).toBe(0);
    expect(normalise({ ...zero, U: 200 }, p95, 25).U).toBe(0);
  });
});
