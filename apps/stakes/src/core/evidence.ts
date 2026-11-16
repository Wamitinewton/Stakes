import {
  formatDate,
  formatUsd,
  type EvidenceItem,
  type EvidenceSource,
  type GoalStatus,
  type Tier,
} from '@stakes/contracts';
import { daysBetween } from './dates.js';
import { TIER_WEIGHT, goalWeight, requestPressure } from './signals.js';

export interface DealInput {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  amountUsd: number;
  probability: number;
  stage: string;
  closeDate: string | null;
  closed: boolean;
  ownerAccountId: string | null;
  url: string;
}

export interface CustomerInput {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
  ownerAccountId: string | null;
  url: string;
}

export interface RequestInput {
  key: string;
  summary: string;
  priority: string;
  createdAt: string;
  slaBreachAt: string | null;
  escalated: boolean;
  assigneeAccountId: string | null;
  url: string;
}

export interface ConversationInput {
  id: string;
  channel: string | null;
  author: string | null;
  text: string;
  at: string;
  url: string;
}

export interface GoalInput {
  id: string;
  name: string;
  status: GoalStatus;
  url: string;
}

// Graph deals carry a stage but no probability. When the mirror has no row for the
// deal, a conventional pipeline probability for the stage stands in.
const STAGE_PROBABILITY: Array<[RegExp, number]> = [
  [/discovery|prospect/i, 0.1],
  [/qualif/i, 0.2],
  [/demo|solution/i, 0.3],
  [/proposal|quote/i, 0.4],
  [/negotiat|contract/i, 0.6],
  [/commit|verbal/i, 0.9],
  [/closed[\s_-]*won/i, 1],
  [/closed[\s_-]*lost/i, 0],
];

export function probabilityForStage(stage: string): number {
  return STAGE_PROBABILITY.find(([re]) => re.test(stage))?.[1] ?? 0.5;
}

const TIER_LABEL: Record<Tier, string> = {
  enterprise: 'Enterprise',
  'mid-market': 'Mid-market',
  smb: 'SMB',
};

export function dealEvidence(
  d: DealInput,
  source: EvidenceSource,
  fetchedAt: string,
): EvidenceItem {
  const pct = Math.round(d.probability * 100);
  return {
    id: `ev-deal-${d.id}`,
    type: 'deal',
    title: d.customerName ? `${d.customerName} · ${d.name}` : d.name,
    value: d.amountUsd,
    unit: 'USD',
    detail: [
      d.id,
      d.closed ? `${d.stage} (closed)` : `${d.stage}, ${pct}%`,
      d.closeDate ? `closes ${formatDate(d.closeDate)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    url: d.url,
    signal: 'R',
    source,
    fetchedAt,
    facts: {
      kind: 'deal',
      dealId: d.id,
      customerId: d.customerId,
      amountUsd: d.amountUsd,
      probability: d.probability,
      stage: d.stage,
      closeDate: d.closeDate,
      closed: d.closed,
      ownerAccountId: d.ownerAccountId,
    },
  };
}

export function customerEvidence(
  c: CustomerInput,
  source: EvidenceSource,
  fetchedAt: string,
): EvidenceItem {
  return {
    id: `ev-customer-${c.id}`,
    type: 'customer',
    title: c.name,
    value: TIER_WEIGHT[c.tier],
    unit: null,
    detail: [
      c.id,
      TIER_LABEL[c.tier],
      c.arrUsd > 0 ? `${formatUsd(c.arrUsd)} ARR` : null,
      c.renewalDate ? `renews ${formatDate(c.renewalDate)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    url: c.url,
    signal: 'C',
    source,
    fetchedAt,
    facts: {
      kind: 'customer',
      customerId: c.id,
      name: c.name,
      tier: c.tier,
      arrUsd: c.arrUsd,
      renewalDate: c.renewalDate,
      ownerAccountId: c.ownerAccountId,
    },
  };
}

export function requestEvidence(r: RequestInput, now: Date, fetchedAt: string): EvidenceItem {
  const facts = {
    kind: 'request' as const,
    requestKey: r.key,
    priority: r.priority,
    createdAt: r.createdAt,
    slaBreachAt: r.slaBreachAt,
    escalated: r.escalated,
    assigneeAccountId: r.assigneeAccountId,
  };
  const age = Math.max(0, -daysBetween(now, r.createdAt));
  return {
    id: `ev-${r.escalated ? 'escalation' : 'jsm_request'}-${r.key}`,
    type: r.escalated ? 'escalation' : 'jsm_request',
    title: `${r.key} · ${r.summary}`,
    value: requestPressure(facts, now),
    unit: null,
    detail: [
      r.priority,
      `open ${age === 1 ? '1 day' : `${age} days`}`,
      r.escalated ? 'escalated' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    url: r.url,
    signal: 'S',
    source: 'jira-rest',
    fetchedAt,
    facts,
  };
}

export function conversationEvidence(
  m: ConversationInput,
  source: EvidenceSource,
  fetchedAt: string,
): EvidenceItem {
  return {
    id: `ev-conversation-${m.id}`,
    type: 'conversation',
    title: [m.channel, m.author].filter(Boolean).join(' · ') || 'Conversation',
    value: 1,
    unit: 'count',
    detail: m.text,
    url: m.url,
    signal: 'H',
    source,
    fetchedAt,
    facts: { kind: 'conversation', at: m.at, channel: m.channel },
  };
}

const GOAL_STATUS_TEXT: Record<GoalStatus, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  'off-track': 'Off track',
  unknown: 'Status unknown',
};

export function goalEvidence(g: GoalInput, fetchedAt: string): EvidenceItem {
  return {
    id: `ev-goal-${g.id}`,
    type: 'goal',
    title: g.name,
    value: goalWeight(g.status),
    unit: null,
    detail: GOAL_STATUS_TEXT[g.status],
    url: g.url,
    signal: 'G',
    source: 'teamwork-graph',
    fetchedAt,
    facts: { kind: 'goal', status: g.status },
  };
}
