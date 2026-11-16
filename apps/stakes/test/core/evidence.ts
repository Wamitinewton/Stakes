import type { EvidenceItem, GoalStatus, Tier } from '@stakes/contracts';

// Builders for evidence items in tests: only the facts matter to the score, so the
// display fields are filled with plausible placeholders.
const base = (id: string, fetchedAt: string) => ({
  title: id,
  detail: '',
  url: `https://example.test/${id}`,
  fetchedAt,
  value: null,
  unit: null,
});

export const FETCHED = '2026-11-20T08:00:00.000Z';

export function deal(
  id: string,
  amountUsd: number,
  probability: number,
  opts: {
    closeDate?: string | null;
    closed?: boolean;
    customerId?: string | null;
    fetchedAt?: string;
  } = {},
): EvidenceItem {
  return {
    ...base(id, opts.fetchedAt ?? FETCHED),
    id: `ev-deal-${id}`,
    type: 'deal',
    signal: 'R',
    source: 'mirror',
    facts: {
      kind: 'deal',
      dealId: id,
      customerId: opts.customerId ?? null,
      amountUsd,
      probability,
      stage: opts.closed ? 'Closed Won' : 'Negotiation',
      closeDate: opts.closeDate ?? null,
      closed: opts.closed ?? false,
      ownerAccountId: null,
    },
  };
}

export function customer(
  id: string,
  tier: Tier,
  opts: { arrUsd?: number; renewalDate?: string | null; fetchedAt?: string } = {},
): EvidenceItem {
  return {
    ...base(id, opts.fetchedAt ?? FETCHED),
    id: `ev-customer-${id}`,
    type: 'customer',
    signal: 'C',
    source: 'mirror',
    facts: {
      kind: 'customer',
      customerId: id,
      name: id,
      tier,
      arrUsd: opts.arrUsd ?? 0,
      renewalDate: opts.renewalDate ?? null,
      ownerAccountId: null,
    },
  };
}

export function request(
  key: string,
  priority: string,
  createdAt: string,
  opts: { escalated?: boolean; slaBreachAt?: string | null; fetchedAt?: string } = {},
): EvidenceItem {
  return {
    ...base(key, opts.fetchedAt ?? FETCHED),
    id: `ev-${opts.escalated ? 'escalation' : 'jsm_request'}-${key}`,
    type: opts.escalated ? 'escalation' : 'jsm_request',
    signal: 'S',
    source: 'jira-rest',
    facts: {
      kind: 'request',
      requestKey: key,
      priority,
      createdAt,
      slaBreachAt: opts.slaBreachAt ?? null,
      escalated: opts.escalated ?? false,
      assigneeAccountId: null,
    },
  };
}

export function message(id: string, at: string, fetchedAt = FETCHED): EvidenceItem {
  return {
    ...base(id, fetchedAt),
    id: `ev-conversation-${id}`,
    type: 'conversation',
    signal: 'H',
    source: 'mirror',
    facts: { kind: 'conversation', at, channel: null },
  };
}

export function goal(id: string, status: GoalStatus, fetchedAt = FETCHED): EvidenceItem {
  return {
    ...base(id, fetchedAt),
    id: `ev-goal-${id}`,
    type: 'goal',
    signal: 'G',
    source: 'teamwork-graph',
    facts: { kind: 'goal', status },
  };
}
