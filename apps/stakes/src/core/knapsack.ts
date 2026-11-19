import type { IssueKey } from '@stakes/contracts';

export interface ScopeCandidate {
  issueKey: IssueKey;
  points: number | null;
  score: number;
}

export interface PlanScopeInput {
  candidates: ScopeCandidate[];
  pinned: IssueKey[];
  capacity: number;
}

export interface ScopePlan {
  chosen: IssueKey[];
  pointsUsed: number;
  scoreCovered: number;
  needsEstimate: IssueKey[];
}

export interface SprintPoints {
  state: string;
  completedPoints: number;
}

interface DpEntry {
  score: number;
  keys: IssueKey[];
}

function compareKeys(a: IssueKey, b: IssueKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeyLists(a: IssueKey[], b: IssueKey[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const comparison = compareKeys(a[i]!, b[i]!);
    if (comparison !== 0) return comparison;
  }
  return a.length - b.length;
}

function isPreferred(candidate: DpEntry, current: DpEntry | undefined): boolean {
  if (!current || candidate.score !== current.score) {
    return !current || candidate.score > current.score;
  }
  return compareKeyLists(candidate.keys, current.keys) < 0;
}

export function planScope({ candidates, pinned, capacity }: PlanScopeInput): ScopePlan {
  const needsEstimate = candidates
    .filter((candidate) => candidate.points === null)
    .map((candidate) => candidate.issueKey)
    .sort(compareKeys);
  const estimated = candidates.flatMap((candidate) =>
    candidate.points === null ? [] : [{ ...candidate, points: Math.ceil(candidate.points) }],
  );
  const pinnedKeys = new Set(pinned);
  const pinnedCandidates = estimated.filter((candidate) => pinnedKeys.has(candidate.issueKey));
  const pinnedPoints = pinnedCandidates.reduce((total, candidate) => total + candidate.points, 0);
  const pinnedScore = pinnedCandidates.reduce((total, candidate) => total + candidate.score, 0);
  const remainingCapacity = Math.max(0, Math.floor(capacity) - pinnedPoints);
  const optional = estimated
    .filter((candidate) => !pinnedKeys.has(candidate.issueKey))
    .sort((a, b) => b.score - a.score || compareKeys(a.issueKey, b.issueKey));

  const dp: Array<DpEntry | undefined> = Array(remainingCapacity + 1);
  dp[0] = { score: 0, keys: [] };

  for (const candidate of optional) {
    for (let used = remainingCapacity - candidate.points; used >= 0; used--) {
      const previous = dp[used];
      if (!previous) continue;
      const next = {
        score: previous.score + candidate.score,
        keys: [...previous.keys, candidate.issueKey].sort(compareKeys),
      };
      const target = used + candidate.points;
      if (isPreferred(next, dp[target])) dp[target] = next;
    }
  }

  let best = { score: 0, keys: [] as IssueKey[], used: 0 };
  for (let used = 0; used <= remainingCapacity; used++) {
    const entry = dp[used];
    if (entry && isPreferred(entry, best)) best = { ...entry, used };
  }

  return {
    chosen: [...pinnedCandidates.map((candidate) => candidate.issueKey), ...best.keys].sort(
      compareKeys,
    ),
    pointsUsed: pinnedPoints + best.used,
    scoreCovered: pinnedScore + best.score,
    needsEstimate,
  };
}

export function defaultCapacity(lastSprints: SprintPoints[]): number | null {
  const closed = lastSprints.filter((sprint) => sprint.state === 'closed').slice(-3);
  if (closed.length === 0) return null;
  return closed.reduce((total, sprint) => total + sprint.completedPoints, 0) / closed.length;
}
