import type { Confidence, EvidenceItem } from '@stakes/contracts';

export const FRESH_EVIDENCE_DAYS = 7;
const DAY_MS = 86_400_000;

// Breadth counts more than volume: seven tickets are still one kind of evidence, while a
// deal, a ticket and a conversation agreeing is a much stronger signal.
export function confidence(evidence: EvidenceItem[], now: Date): Confidence {
  const types = new Set(evidence.map((e) => e.type)).size;
  if (types <= 1) return 'low';
  if (types === 2) return 'medium';
  const oldest = Math.min(...evidence.map((e) => new Date(e.fetchedAt).getTime()));
  return now.getTime() - oldest <= FRESH_EVIDENCE_DAYS * DAY_MS ? 'high' : 'medium';
}
