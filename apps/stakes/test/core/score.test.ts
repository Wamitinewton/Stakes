import { describe, expect, it } from 'vitest';
import { normalise } from '../../src/core/normalise';
import { DEFAULT_WEIGHTS, renormaliseWeights, score } from '../../src/core/score';

const ones = { R: 1, S: 1, C: 1, H: 1, G: 1, U: 1 };

describe('score', () => {
  it('scores PAY-142 at 89 with the documented contributions', () => {
    const norm = normalise(
      { R: 316_000, S: 15.5, C: 8, H: 6, G: 1, U: 25 },
      { R: 450_000, S: 18, C: 9, H: 10 },
      25,
    );
    const result = score(norm, DEFAULT_WEIGHTS);
    expect(result.score).toBe(89);
    const rounded = Object.fromEntries(
      Object.entries(result.contributions).map(([k, v]) => [k, Math.round(v * 10) / 10]),
    );
    expect(rounded).toEqual({ R: 34.0, S: 19.0, C: 14.3, H: 8.1, G: 6.7, U: 7.2 });
  });

  it('gives 100 when every signal is saturated and 0 when none is', () => {
    expect(score(ones, DEFAULT_WEIGHTS).score).toBe(100);
    expect(score({ R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 }, DEFAULT_WEIGHTS).score).toBe(0);
  });

  it('renormalises weights that do not sum to 1', () => {
    const doubled = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, v * 2]));
    const norm = { R: 0.5, S: 0.2, C: 0.9, H: 0, G: 1, U: 0.3 };
    expect(score(norm, doubled as typeof DEFAULT_WEIGHTS)).toEqual(score(norm, DEFAULT_WEIGHTS));
    const w = renormaliseWeights({ R: 1, S: 1, C: 0, H: 0, G: 0, U: 2 });
    expect(w).toEqual({ R: 0.25, S: 0.25, C: 0, H: 0, G: 0, U: 0.5 });
  });

  it('rejects all-zero, negative and non-numeric weights', () => {
    expect(() => renormaliseWeights({ R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 })).toThrow(RangeError);
    expect(() => renormaliseWeights({ ...DEFAULT_WEIGHTS, R: -1 })).toThrow(RangeError);
    expect(() => renormaliseWeights({ ...DEFAULT_WEIGHTS, R: Number.NaN })).toThrow(RangeError);
  });

  it('rounds once, from unrounded contributions', () => {
    // 0.35 × 0.0142857 × 100 = 0.5 exactly at the boundary: rounds up to 1.
    const r = score({ R: 1 / 70, S: 0, C: 0, H: 0, G: 0, U: 0 }, DEFAULT_WEIGHTS);
    expect(r.contributions.R).toBeCloseTo(0.5);
    expect(r.score).toBe(1);
  });
});
