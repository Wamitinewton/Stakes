import type { SignalKey } from '@stakes/contracts';
import type { RawSignals } from './signals';

export type LogSignal = 'R' | 'S' | 'C' | 'H';
export type P95 = Record<LogSignal, number>;
export type NormSignals = Record<SignalKey, number>;

// A floor stops a project of tiny deals or quiet support queues from making every issue
// look maximal, and stands in for percentiles until there is enough data to trust them.
export const FLOORS: P95 = { R: 100_000, S: 5, C: 3, H: 5 };
export const MIN_SCORED_FOR_PERCENTILES = 10;
export const GOAL_MAX = 1.5;
export const URGENCY_HORIZON_DAYS = 90;

const logScale = (x: number, ceiling: number) =>
  x <= 0 ? 0 : Math.min(1, Math.log(1 + x) / Math.log(1 + ceiling));

export function effectiveCeilings(p95: P95 | null, scoredCount: number): P95 {
  const usePercentiles = p95 !== null && scoredCount >= MIN_SCORED_FOR_PERCENTILES;
  const pick = (k: LogSignal) => (usePercentiles ? Math.max(p95[k], FLOORS[k]) : FLOORS[k]);
  return { R: pick('R'), S: pick('S'), C: pick('C'), H: pick('H') };
}

export function normalise(raw: RawSignals, p95: P95 | null, scoredCount: number): NormSignals {
  const ceiling = effectiveCeilings(p95, scoredCount);
  return {
    R: logScale(raw.R, ceiling.R),
    S: logScale(raw.S, ceiling.S),
    C: logScale(raw.C, ceiling.C),
    H: logScale(raw.H, ceiling.H),
    G: Math.min(1, Math.max(0, raw.G / GOAL_MAX)),
    U: raw.U === null ? 0 : Math.max(0, 1 - raw.U / URGENCY_HORIZON_DAYS),
  };
}
