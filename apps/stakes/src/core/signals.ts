import type { EvidenceFacts, EvidenceItem, GoalStatus, Tier } from '@stakes/contracts';
import { daysBetween } from './dates.js';

export interface RawSignals {
  R: number;
  S: number;
  C: number;
  H: number;
  G: number;
  U: number | null;
}

export const TIER_WEIGHT: Record<Tier, number> = { enterprise: 3, 'mid-market': 2, smb: 1 };
export const RENEWAL_WINDOW_DAYS = 90;
export const CONVERSATION_WINDOW_DAYS = 30;
const AGE_STEP_DAYS = 14;

type Facts<K extends EvidenceFacts['kind']> = Extract<EvidenceFacts, { kind: K }>;

// Service desks rename priorities freely, so the common synonyms map onto the four
// weights; an unrecognised name counts as a normal request rather than being dropped.
export function jsmPriorityWeight(priority: string): number {
  const p = priority.trim().toLowerCase();
  if (['highest', 'critical', 'blocker', 'urgent'].includes(p)) return 4;
  if (['high', 'major'].includes(p)) return 3;
  if (['low', 'lowest', 'minor', 'trivial'].includes(p)) return 1;
  return 2;
}

export function goalWeight(status: GoalStatus): number {
  return status === 'at-risk' || status === 'off-track' ? 1.5 : 1;
}

export function isRenewingSoon(renewalDate: string | null, now: Date): boolean {
  return renewalDate !== null && daysBetween(now, renewalDate) <= RENEWAL_WINDOW_DAYS;
}

export function requestPressure(f: Facts<'request'>, now: Date): number {
  const ageDays = Math.max(0, -daysBetween(now, f.createdAt));
  const base = jsmPriorityWeight(f.priority) + 0.5 * Math.floor(ageDays / AGE_STEP_DAYS);
  return f.escalated ? base * 2 : base;
}

// The same deal or customer can reach an issue twice (through a deal and directly, or
// from two sources); it must count once. If the copies disagree, the choice between them
// must not depend on the order sources answered in, so the same one always wins.
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, { item: T; json: string }>();
  for (const item of items) {
    const json = JSON.stringify(item);
    const current = seen.get(key(item));
    if (!current || json < current.json) seen.set(key(item), { item, json });
  }
  return [...seen.values()].map((v) => v.item);
}

export function factsOf<K extends EvidenceFacts['kind']>(
  evidence: EvidenceItem[],
  kind: K,
): Facts<K>[] {
  return evidence.map((e) => e.facts).filter((f): f is Facts<K> => f.kind === kind);
}

export function openDeals(evidence: EvidenceItem[]): Facts<'deal'>[] {
  return uniqueBy(factsOf(evidence, 'deal'), (d) => d.dealId).filter((d) => !d.closed);
}

export function distinctCustomers(evidence: EvidenceItem[]): Facts<'customer'>[] {
  return uniqueBy(factsOf(evidence, 'customer'), (c) => c.customerId);
}

export function rawSignals(evidence: EvidenceItem[], now: Date): RawSignals {
  const deals = openDeals(evidence);
  const customers = distinctCustomers(evidence);
  const requests = uniqueBy(factsOf(evidence, 'request'), (r) => r.requestKey);
  const conversations = factsOf(evidence, 'conversation');
  const goals = factsOf(evidence, 'goal');

  const R =
    deals.reduce((sum, d) => sum + d.amountUsd * d.probability, 0) +
    customers
      .filter((c) => isRenewingSoon(c.renewalDate, now))
      .reduce((sum, c) => sum + c.arrUsd, 0);

  const S = requests.reduce((sum, r) => sum + requestPressure(r, now), 0);
  const C = customers.reduce((sum, c) => sum + TIER_WEIGHT[c.tier], 0);
  const H = conversations.filter((m) => daysBetween(now, m.at) >= -CONVERSATION_WINDOW_DAYS).length;
  const G = goals.reduce((max, g) => Math.max(max, goalWeight(g.status)), 0);

  const dates = [
    ...deals.map((d) => d.closeDate),
    ...customers.map((c) => c.renewalDate),
    ...requests.map((r) => r.slaBreachAt),
  ].filter((d): d is string => d !== null);
  const U =
    dates.length === 0 ? null : Math.min(...dates.map((d) => Math.max(0, daysBetween(now, d))));

  return { R, S, C, H, G, U };
}
