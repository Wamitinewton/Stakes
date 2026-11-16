import { SIGNAL_KEYS, type SignalKey, type Weights } from '@stakes/contracts';
import type { NormSignals } from './normalise.js';

export const DEFAULT_WEIGHTS: Weights = { R: 0.35, S: 0.2, C: 0.15, H: 0.1, G: 0.1, U: 0.1 };

export function renormaliseWeights(weights: Weights): Weights {
  for (const k of SIGNAL_KEYS) {
    if (!Number.isFinite(weights[k]) || weights[k] < 0) {
      throw new RangeError(`Weight ${k} must be a non-negative number`);
    }
  }
  const total = SIGNAL_KEYS.reduce((sum, k) => sum + weights[k], 0);
  if (total === 0) throw new RangeError('At least one weight must be above zero');
  return Object.fromEntries(SIGNAL_KEYS.map((k) => [k, weights[k] / total])) as Weights;
}

export interface ScoreResult {
  score: number;
  // Unrounded points per signal; the panel rounds them for display only, so the tiles
  // may not add up to the score exactly but the score is never rounded twice.
  contributions: Record<SignalKey, number>;
}

export function score(norm: NormSignals, weights: Weights): ScoreResult {
  const w = renormaliseWeights(weights);
  const contributions = Object.fromEntries(
    SIGNAL_KEYS.map((k) => [k, 100 * w[k] * norm[k]]),
  ) as Record<SignalKey, number>;
  const total = SIGNAL_KEYS.reduce((sum, k) => sum + contributions[k], 0);
  return { score: Math.min(100, Math.max(0, Math.round(total))), contributions };
}
