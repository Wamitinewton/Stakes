import type { EvidenceItem, Snapshot } from '@stakes/contracts';

// A realistic evidence item with long display strings, so size checks are pessimistic.
export function bulkyEvidence(i: number): EvidenceItem {
  return {
    id: `ev-jsm_request-HELP-${i}`,
    type: 'jsm_request',
    title: `HELP-${i} · ${'Export over ten thousand rows fails with a timeout '.repeat(2)}`,
    value: 3.5,
    unit: null,
    detail: `High · open 15 days · ${'Kilima Freight finance team '.repeat(3)}`,
    url: `https://example.atlassian.net/browse/HELP-${i}`,
    signal: 'S',
    source: 'jira-rest',
    fetchedAt: '2026-11-20T08:00:00.000Z',
    facts: {
      kind: 'request',
      requestKey: `HELP-${i}`,
      priority: 'High',
      createdAt: '2026-11-05T08:00:00.000Z',
      slaBreachAt: '2026-11-25T08:00:00.000Z',
      escalated: false,
      assigneeAccountId: '5b10ac8d82e05b22cc7d4ef5',
    },
  };
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const zero = { R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 };
  return {
    issueKey: 'PAY-142',
    projectKey: 'PAY',
    score: 89,
    confidence: 'high',
    raw: { ...zero, U: null },
    normalised: zero,
    contributions: zero,
    evidence: [],
    currentPriority: 'Low',
    suggestedPriority: 'Highest',
    badges: ['silent-fire'],
    weightsUsed: { R: 0.35, S: 0.2, C: 0.15, H: 0.1, G: 0.1, U: 0.1 },
    weightsVersion: 1,
    dealsVersion: 0,
    evidenceHash: 'h',
    summary: { text: 'Template summary.', generated: false, citedIds: [] },
    degraded: [],
    hiddenItems: 0,
    computedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}
