import { describe, expect, it } from 'vitest';
import {
  defaultCapacity,
  planScope,
  type PlanScopeInput,
  type ScopePlan,
} from '../../src/core/knapsack.js';

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeyLists(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const comparison = compareKeys(a[i]!, b[i]!);
    if (comparison !== 0) return comparison;
  }
  return a.length - b.length;
}

function bruteForce({ candidates, pinned, capacity }: PlanScopeInput): ScopePlan {
  const pinnedKeys = new Set(pinned);
  const estimated = candidates.filter((candidate) => candidate.points !== null);
  const pinnedCandidates = estimated.filter((candidate) => pinnedKeys.has(candidate.issueKey));
  const optional = estimated.filter((candidate) => !pinnedKeys.has(candidate.issueKey));
  const pinnedPoints = pinnedCandidates.reduce(
    (total, candidate) => total + Math.ceil(candidate.points!),
    0,
  );
  const pinnedScore = pinnedCandidates.reduce((total, candidate) => total + candidate.score, 0);
  const remainingCapacity = Math.max(0, Math.floor(capacity) - pinnedPoints);
  let best = { keys: [] as string[], points: 0, score: 0 };

  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    let points = 0;
    let score = 0;
    const keys: string[] = [];
    for (let i = 0; i < optional.length; i++) {
      if ((mask & (2 ** i)) === 0) continue;
      const candidate = optional[i]!;
      points += Math.ceil(candidate.points!);
      score += candidate.score;
      keys.push(candidate.issueKey);
    }
    if (points > remainingCapacity) continue;
    keys.sort(compareKeys);
    if (score > best.score || (score === best.score && compareKeyLists(keys, best.keys) < 0)) {
      best = { keys, points, score };
    }
  }

  return {
    chosen: [...pinnedCandidates.map((candidate) => candidate.issueKey), ...best.keys].sort(
      compareKeys,
    ),
    pointsUsed: pinnedPoints + best.points,
    scoreCovered: pinnedScore + best.score,
    needsEstimate: candidates
      .filter((candidate) => candidate.points === null)
      .map((candidate) => candidate.issueKey)
      .sort(compareKeys),
  };
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('planScope', () => {
  it('maximises covered score within capacity', () => {
    const result = planScope({
      candidates: [
        { issueKey: 'PAY-1', points: 4, score: 40 },
        { issueKey: 'PAY-2', points: 5, score: 70 },
        { issueKey: 'PAY-3', points: 6, score: 80 },
      ],
      pinned: [],
      capacity: 9,
    });

    expect(result).toEqual({
      chosen: ['PAY-1', 'PAY-2'],
      pointsUsed: 9,
      scoreCovered: 110,
      needsEstimate: [],
    });
  });

  it('retains pinned issues first, even when they exceed capacity', () => {
    expect(
      planScope({
        candidates: [
          { issueKey: 'PAY-1', points: 5, score: 50 },
          { issueKey: 'PAY-2', points: 4, score: 100 },
        ],
        pinned: ['PAY-1'],
        capacity: 4,
      }),
    ).toEqual({ chosen: ['PAY-1'], pointsUsed: 5, scoreCovered: 50, needsEstimate: [] });

    expect(
      planScope({
        candidates: [
          { issueKey: 'PAY-1', points: 3, score: 20 },
          { issueKey: 'PAY-2', points: 5, score: 30 },
          { issueKey: 'PAY-3', points: 4, score: 100 },
        ],
        pinned: ['PAY-1'],
        capacity: 8,
      }),
    ).toEqual({ chosen: ['PAY-1', 'PAY-3'], pointsUsed: 7, scoreCovered: 120, needsEstimate: [] });
  });

  it('rounds fractional points up for both candidates and capacity accounting', () => {
    const result = planScope({
      candidates: [
        { issueKey: 'PAY-1', points: 1.2, score: 10 },
        { issueKey: 'PAY-2', points: 1, score: 9 },
      ],
      pinned: [],
      capacity: 2.8,
    });

    expect(result.chosen).toEqual(['PAY-1']);
    expect(result.pointsUsed).toBe(2);
    expect(result.scoreCovered).toBe(10);
  });

  it('skips issues without estimates and reports their keys', () => {
    const result = planScope({
      candidates: [
        { issueKey: 'PAY-3', points: null, score: 100 },
        { issueKey: 'PAY-1', points: 2, score: 20 },
        { issueKey: 'PAY-2', points: null, score: 90 },
      ],
      pinned: ['PAY-3'],
      capacity: 2,
    });

    expect(result).toEqual({
      chosen: ['PAY-1'],
      pointsUsed: 2,
      scoreCovered: 20,
      needsEstimate: ['PAY-2', 'PAY-3'],
    });
  });

  it('prefers higher scores and then lower keys on ties regardless of input order', () => {
    const candidates = [
      { issueKey: 'PAY-2', points: 2, score: 20 },
      { issueKey: 'PAY-1', points: 2, score: 20 },
      { issueKey: 'PAY-3', points: 2, score: 30 },
    ];
    expect(planScope({ candidates, pinned: [], capacity: 2 }).chosen).toEqual(['PAY-3']);
    expect(
      planScope({ candidates: candidates.slice(0, 2), pinned: [], capacity: 2 }).chosen,
    ).toEqual(['PAY-1']);
    expect(
      planScope({ candidates: [...candidates.slice(0, 2)].reverse(), pinned: [], capacity: 2 }),
    ).toEqual(planScope({ candidates: candidates.slice(0, 2), pinned: [], capacity: 2 }));
  });

  it('handles empty scope and zero-point candidates', () => {
    expect(planScope({ candidates: [], pinned: [], capacity: 5 })).toEqual({
      chosen: [],
      pointsUsed: 0,
      scoreCovered: 0,
      needsEstimate: [],
    });
    expect(
      planScope({
        candidates: [{ issueKey: 'PAY-1', points: 0, score: 10 }],
        pinned: [],
        capacity: 0,
      }),
    ).toEqual({ chosen: ['PAY-1'], pointsUsed: 0, scoreCovered: 10, needsEstimate: [] });
  });

  it('matches brute force on 200 randomized inputs of at most 12 candidates', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = rng(seed);
      const count = Math.floor(next() * 13);
      const candidates = Array.from({ length: count }, (_, index) => ({
        issueKey: `PAY-${index + 1}`,
        points: next() < 0.15 ? null : 1 + Math.floor(next() * 5) + (next() < 0.25 ? 0.5 : 0),
        score: Math.floor(next() * 101),
      }));
      const pinned = candidates.filter(() => next() < 0.15).map((candidate) => candidate.issueKey);
      const input = { candidates, pinned, capacity: Math.floor(next() * 21) };

      expect(planScope(input), `seed ${seed}`).toEqual(bruteForce(input));
      expect(
        planScope({ ...input, candidates: [...candidates].reverse() }),
        `seed ${seed}`,
      ).toEqual(bruteForce(input));
    }
  });
});

describe('defaultCapacity', () => {
  it('returns null when there are no closed sprints', () => {
    expect(defaultCapacity([])).toBeNull();
    expect(
      defaultCapacity([
        { state: 'active', completedPoints: 12 },
        { state: 'future', completedPoints: 0 },
      ]),
    ).toBeNull();
  });

  it('averages completed points when fewer than three sprints are closed', () => {
    expect(
      defaultCapacity([
        { state: 'closed', completedPoints: 10 },
        { state: 'closed', completedPoints: 11 },
      ]),
    ).toBe(10.5);
  });

  it('uses only the latest three closed sprints', () => {
    expect(
      defaultCapacity([
        { state: 'closed', completedPoints: 8 },
        { state: 'active', completedPoints: 100 },
        { state: 'closed', completedPoints: 12 },
        { state: 'closed', completedPoints: 16 },
        { state: 'future', completedPoints: 0 },
        { state: 'closed', completedPoints: 20 },
      ]),
    ).toBe(16);
  });
});
