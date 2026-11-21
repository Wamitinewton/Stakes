import { describe, expect, it } from 'vitest';
import { SIGNAL_KEYS } from '@stakes/contracts';
import { previewScore, setWeight, toPercents } from '../../src/frontend/weights';

const defaults = { R: 0.35, S: 0.2, C: 0.15, H: 0.1, G: 0.1, U: 0.1 };
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('weight sliders', () => {
  it('keeps the total at 1 and the other weights in proportion', () => {
    const next = setWeight(defaults, 'R', 0.5);
    expect(next.R).toBe(0.5);
    expect(sum(next)).toBeCloseTo(1);
    expect(next.S / next.C).toBeCloseTo(0.2 / 0.15);
  });

  it('spreads the rest evenly when every other weight is zero', () => {
    const next = setWeight({ R: 1, S: 0, C: 0, H: 0, G: 0, U: 0 }, 'R', 0.5);
    expect(next.S).toBeCloseTo(0.1);
    expect(sum(next)).toBeCloseTo(1);
  });

  it('clamps a share outside 0–1', () => {
    expect(setWeight(defaults, 'G', 2).G).toBe(1);
    expect(setWeight(defaults, 'G', -1).G).toBe(0);
  });

  it('shows whole percentages that always add up to 100', () => {
    expect(toPercents(defaults)).toEqual({ R: 35, S: 20, C: 15, H: 10, G: 10, U: 10 });
    const thirds = toPercents({ R: 1, S: 1, C: 1, H: 0, G: 0, U: 0 });
    expect(sum(thirds)).toBe(100);
    for (let i = 0; i < 50; i++) {
      const w = Object.fromEntries(
        SIGNAL_KEYS.map((k, j) => [k, ((i + 1) * (j + 3)) % 7]),
      ) as typeof defaults;
      if (sum(w) > 0) expect(sum(toPercents(w))).toBe(100);
    }
  });

  it('previews the score with the same arithmetic as the engine', () => {
    const norm = { R: 0.973, S: 0.952, C: 0.954, H: 0.811, G: 0.667, U: 0.722 };
    expect(previewScore(norm, defaults)).toBe(89);
    expect(previewScore(norm, { R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 })).toBe(0);
  });
});
