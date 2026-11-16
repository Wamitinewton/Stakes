import { SIGNAL_KEYS, type SignalKey, type Weights } from '@stakes/contracts';

// Moving one slider sets that signal's share; the others shrink or grow in proportion
// to make room, so the six always add up to 100%.
export function setWeight(weights: Weights, key: SignalKey, share: number): Weights {
  const target = Math.min(1, Math.max(0, share));
  const others = SIGNAL_KEYS.filter((k) => k !== key);
  const rest = others.reduce((sum, k) => sum + weights[k], 0);
  const next = { ...weights, [key]: target };
  for (const k of others) {
    next[k] = rest === 0 ? (1 - target) / others.length : (weights[k] / rest) * (1 - target);
  }
  return next;
}

// Whole percentages that add up to exactly 100, using the largest remainders, so the
// table never shows a total of 99% or 101%.
export function toPercents(weights: Weights): Record<SignalKey, number> {
  const total = SIGNAL_KEYS.reduce((sum, k) => sum + weights[k], 0) || 1;
  const exact = SIGNAL_KEYS.map((k) => ({ k, v: (weights[k] / total) * 100 }));
  const out = Object.fromEntries(exact.map(({ k, v }) => [k, Math.floor(v)])) as Record<
    SignalKey,
    number
  >;
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  for (const { k } of [...exact].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left-- <= 0) break;
    out[k] += 1;
  }
  return out;
}

// The same arithmetic as the score engine, for the live "PAY-142 would score" preview.
export function previewScore(normalised: Record<SignalKey, number>, weights: Weights): number {
  const total = SIGNAL_KEYS.reduce((sum, k) => sum + weights[k], 0);
  if (total === 0) return 0;
  return Math.round(
    (100 * SIGNAL_KEYS.reduce((sum, k) => sum + weights[k] * normalised[k], 0)) / total,
  );
}
