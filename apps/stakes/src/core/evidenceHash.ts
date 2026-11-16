import type { EvidenceItem } from '@stakes/contracts';

// Key order is fixed so two equal objects always serialise to the same string.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// What the evidence hash covers: every item, in id order, without the fetch time, so
// re-reading unchanged data keeps the same hash and the cached AI summary stays valid.
export function canonicalEvidence(evidence: EvidenceItem[]): string {
  const items = [...evidence]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ fetchedAt: _fetchedAt, ...rest }) => stable(rest));
  return JSON.stringify(items);
}
