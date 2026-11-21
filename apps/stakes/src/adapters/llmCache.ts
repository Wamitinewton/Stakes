import { createHash } from 'node:crypto';
import type { EvidenceItem } from '@stakes/contracts';
import { canonicalEvidence } from '../core/evidenceHash';
import type { TextPurpose } from './llm';

export function promptCacheKey(
  purpose: TextPurpose,
  evidence: EvidenceItem[],
  context: Record<string, string>,
): string {
  const sortedContext = Object.fromEntries(
    Object.keys(context)
      .sort()
      .map((key) => [key, context[key]]),
  );
  const hash = createHash('sha256')
    .update(canonicalEvidence(evidence))
    .update('\n')
    .update(JSON.stringify(sortedContext))
    .digest('hex');
  return `${purpose}:${hash}`;
}
