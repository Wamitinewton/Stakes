import type { BandName, Bands } from '@stakes/contracts';

export const DEFAULT_BANDS: Bands = {
  thresholds: { highest: 75, high: 55, medium: 35, low: 15 },
  priorities: { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' },
};

export function bandFor(score: number, bands: Bands): BandName {
  const t = bands.thresholds;
  if (score >= t.highest) return 'highest';
  if (score >= t.high) return 'high';
  if (score >= t.medium) return 'medium';
  if (score >= t.low) return 'low';
  return 'lowest';
}

// Null when the band's priority name does not exist on this site yet; the UI hides
// Apply rather than suggest a priority Jira would reject.
export function suggestPriority(score: number, bands: Bands): string | null {
  return bands.priorities[bandFor(score, bands)];
}
