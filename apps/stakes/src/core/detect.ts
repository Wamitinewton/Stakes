import type { Badge, Bands } from '@stakes/contracts';

export interface DetectThresholds {
  silentFireMin: number;
  phantomBelow: number;
  jumpMin: number;
  lowPriorities: string[];
  highPriorities: string[];
}

export interface DetectInput {
  score: number;
  currentPriority: string;
  evidenceCount: number;
  score7DaysAgo: number | null;
  thresholds: DetectThresholds;
}

// The rules follow the bands: a silent fire is anything scoring into the High band or
// above while sitting at a low priority, so moving a band boundary moves the rule too.
export function detectThresholds(bands: Bands, jumpMin: number): DetectThresholds {
  const names = (list: Array<string | null>) =>
    list.filter((p): p is string => p !== null).map((p) => p.toLowerCase());
  return {
    silentFireMin: bands.thresholds.high,
    phantomBelow: bands.thresholds.low,
    jumpMin,
    lowPriorities: names([bands.priorities.low, bands.priorities.lowest]),
    highPriorities: names([bands.priorities.high, bands.priorities.highest]),
  };
}

export function detect(input: DetectInput): Badge[] {
  const { score, thresholds: t } = input;
  const priority = input.currentPriority.toLowerCase();
  const badges: Badge[] = [];
  if (score >= t.silentFireMin && t.lowPriorities.includes(priority)) badges.push('silent-fire');
  if (t.highPriorities.includes(priority) && score < t.phantomBelow && input.evidenceCount === 0) {
    badges.push('phantom');
  }
  if (input.score7DaysAgo !== null && score - input.score7DaysAgo >= t.jumpMin) {
    badges.push('stakes-jump');
  }
  return badges;
}
