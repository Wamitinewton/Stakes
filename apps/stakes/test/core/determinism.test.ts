import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@stakes/contracts';
import { rawSignals } from '../../src/core/signals';
import { normalise } from '../../src/core/normalise';
import { DEFAULT_WEIGHTS, score } from '../../src/core/score';
import { customer, deal, goal, message, request } from './evidence';

// A small deterministic generator, so a failure reproduces from the printed seed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const tiers = ['enterprise', 'mid-market', 'smb'] as const;
const statuses = ['on-track', 'at-risk', 'off-track', 'unknown'] as const;

function randomEvidence(next: () => number): EvidenceItem[] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  const day = () =>
    `2026-${String(10 + Math.floor(next() * 3)).padStart(2, '0')}-${String(1 + Math.floor(next() * 28)).padStart(2, '0')}`;
  const out: EvidenceItem[] = [];
  const n = Math.floor(next() * 20);
  for (let i = 0; i < n; i++) {
    const kind = Math.floor(next() * 5);
    if (kind === 0)
      out.push(
        deal(`D${i}`, Math.floor(next() * 300_000), next(), {
          closeDate: day(),
          closed: next() < 0.2,
        }),
      );
    if (kind === 1)
      out.push(
        customer(`C${i % 4}`, pick(tiers), {
          arrUsd: Math.floor(next() * 500_000),
          renewalDate: day(),
        }),
      );
    if (kind === 2)
      out.push(
        request(`H-${i}`, pick(['Highest', 'High', 'Medium', 'Low']), `${day()}T00:00:00Z`, {
          escalated: next() < 0.3,
        }),
      );
    if (kind === 3) out.push(message(`M${i}`, `${day()}T00:00:00Z`));
    if (kind === 4) out.push(goal(`G${i}`, pick(statuses)));
  }
  return out;
}

describe('determinism', () => {
  it('gives the same score for the same evidence, 500 random cases', () => {
    const now = new Date('2026-11-20T08:00:00Z');
    const p95 = { R: 450_000, S: 18, C: 9, H: 10 };
    for (let seed = 1; seed <= 500; seed++) {
      const evidence = randomEvidence(rng(seed));
      const run = () => score(normalise(rawSignals(evidence, now), p95, 25), DEFAULT_WEIGHTS);
      const first = run();
      expect(run(), `seed ${seed}`).toEqual(first);
      expect(first.score).toBeGreaterThanOrEqual(0);
      expect(first.score).toBeLessThanOrEqual(100);
      // Order of evidence must not matter either.
      const reversed = score(
        normalise(rawSignals([...evidence].reverse(), now), p95, 25),
        DEFAULT_WEIGHTS,
      );
      expect(reversed.score, `seed ${seed}`).toBe(first.score);
    }
  });
});
