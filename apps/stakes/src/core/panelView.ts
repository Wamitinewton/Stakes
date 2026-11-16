import {
  SIGNAL_KEYS,
  formatDate,
  formatUsd,
  plural,
  type EvidenceItem,
  type PanelCustomer,
  type PanelTile,
  type PanelView,
  type SignalKey,
  type Snapshot,
  type Tier,
} from '@stakes/contracts';
import { daysBetween } from './dates.js';
import { TIER_WEIGHT, distinctCustomers, factsOf, isRenewingSoon, openDeals } from './signals.js';

export const TILE_LABELS: Record<SignalKey, string> = {
  R: 'Revenue at risk',
  S: 'Support pressure',
  C: 'Customers',
  H: 'Conversation heat',
  G: 'Goal alignment',
  U: 'Urgency',
};

const TIER_LABEL: Record<Tier, string> = {
  enterprise: 'Enterprise',
  'mid-market': 'Mid-market',
  smb: 'SMB',
};

const idsWhere = (evidence: EvidenceItem[], keep: (e: EvidenceItem) => boolean) =>
  evidence.filter(keep).map((e) => e.id);

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

interface DatedItem {
  id: string;
  days: number;
  date: string;
  upcoming: string;
  passed: string;
}

// Every item that can set urgency, nearest first, so the tile can name the one that
// actually sets the number.
function datedItems(evidence: EvidenceItem[], now: Date): DatedItem[] {
  const out: DatedItem[] = [];
  for (const e of evidence) {
    const f = e.facts;
    if (f.kind === 'deal' && !f.closed && f.closeDate) {
      out.push({
        id: e.id,
        days: daysBetween(now, f.closeDate),
        date: f.closeDate,
        upcoming: `${e.title} closes`,
        passed: `${e.title} was due to close`,
      });
    } else if (f.kind === 'customer' && f.renewalDate) {
      out.push({
        id: e.id,
        days: daysBetween(now, f.renewalDate),
        date: f.renewalDate,
        upcoming: `${f.name} renews`,
        passed: `${f.name} was due to renew`,
      });
    } else if (f.kind === 'request' && f.slaBreachAt) {
      out.push({
        id: e.id,
        days: daysBetween(now, f.slaBreachAt),
        date: f.slaBreachAt,
        upcoming: `${f.requestKey} SLA breaches`,
        passed: `${f.requestKey} SLA breached`,
      });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.id.localeCompare(b.id));
}

export type ScoredEvidence = Pick<Snapshot, 'evidence' | 'raw' | 'contributions'>;

export function buildTiles(snapshot: ScoredEvidence, now: Date): PanelTile[] {
  const { evidence, raw, contributions } = snapshot;
  const deals = openDeals(evidence);
  const customers = distinctCustomers(evidence);
  const renewing = customers.filter((c) => isRenewingSoon(c.renewalDate, now));
  const requests = factsOf(evidence, 'request');
  const escalated = requests.filter((r) => r.escalated).length;
  const goals = factsOf(evidence, 'goal');
  const dated = datedItems(evidence, now);
  const openDealIds = new Set(deals.map((d) => `ev-deal-${d.dealId}`));
  const renewingIds = new Set(renewing.map((c) => `ev-customer-${c.customerId}`));

  const tierCounts = (['enterprise', 'mid-market', 'smb'] as const)
    .map((t) => [t, customers.filter((c) => c.tier === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${TIER_LABEL[t]}`)
    .join(', ');

  const dealTotal = deals.reduce((sum, d) => sum + d.amountUsd, 0);
  const renewalTotal = renewing.reduce((sum, c) => sum + c.arrUsd, 0);
  const firstGoal = evidence.find((e) => e.facts.kind === 'goal');
  const nearest = dated[0];

  const tiles: Record<SignalKey, Omit<PanelTile, 'signal' | 'label' | 'points'>> = {
    R: {
      rawDisplay:
        deals.length > 0
          ? `${formatUsd(dealTotal)} · ${plural(deals.length, 'deal')}`
          : renewing.length > 0
            ? `${formatUsd(renewalTotal)} renewing`
            : 'No open deals',
      detail:
        raw.R === 0
          ? 'Nothing weighted yet'
          : `${formatUsd(raw.R ?? 0)} weighted by stage${
              renewing.length > 0 ? `, ${plural(renewing.length, 'renewal')} within 90 days` : ''
            }`,
      evidenceIds: idsWhere(evidence, (e) => openDealIds.has(e.id) || renewingIds.has(e.id)),
    },
    S: {
      rawDisplay:
        requests.length > 0
          ? `${oneDecimal(raw.S ?? 0)} · ${plural(requests.length, 'request')}`
          : 'No open requests',
      detail: requests.length === 0 ? 'No linked support requests' : `${escalated} escalated`,
      evidenceIds: idsWhere(evidence, (e) => e.facts.kind === 'request'),
    },
    C: {
      rawDisplay:
        customers.length > 0
          ? `${raw.C} pts · ${plural(customers.length, 'customer')}`
          : 'No customers',
      detail: tierCounts || 'No linked customers',
      evidenceIds: idsWhere(evidence, (e) => e.facts.kind === 'customer'),
    },
    H: {
      rawDisplay: plural(raw.H ?? 0, 'message'),
      detail: 'Last 30 days',
      evidenceIds: idsWhere(evidence, (e) => e.facts.kind === 'conversation'),
    },
    G: {
      rawDisplay: goals.length > 0 ? plural(goals.length, 'goal') : 'No goal',
      detail: firstGoal
        ? `${firstGoal.title}, ${goalStatusText(goals.map((g) => g.status))}`
        : 'Not linked to a goal',
      evidenceIds: idsWhere(evidence, (e) => e.facts.kind === 'goal'),
    },
    U: {
      rawDisplay: raw.U === null ? 'No dates' : plural(raw.U, 'day'),
      detail: nearest
        ? `${nearest.days < 0 ? nearest.passed : nearest.upcoming} ${formatDate(nearest.date)}`
        : 'No close, renewal or SLA dates',
      evidenceIds: dated.map((d) => d.id),
    },
  };

  return SIGNAL_KEYS.map((signal) => ({
    signal,
    label: TILE_LABELS[signal],
    points: contributions[signal],
    ...tiles[signal],
  })).sort(
    (a, b) => b.points - a.points || SIGNAL_KEYS.indexOf(a.signal) - SIGNAL_KEYS.indexOf(b.signal),
  );
}

function goalStatusText(statuses: string[]): string {
  if (statuses.includes('off-track')) return 'off track';
  if (statuses.includes('at-risk')) return 'at risk';
  if (statuses.includes('on-track')) return 'on track';
  return 'status unknown';
}

export const MAX_PANEL_CUSTOMERS = 5;

export function topCustomers(evidence: EvidenceItem[]): PanelCustomer[] {
  const deals = openDeals(evidence);
  return distinctCustomers(evidence)
    .map((c) => {
      const own = deals.filter((d) => d.customerId === c.customerId);
      const closeDates = own
        .map((d) => d.closeDate)
        .filter((d): d is string => d !== null)
        .sort();
      return {
        id: c.customerId,
        name: c.name,
        tier: c.tier,
        dealValueUsd: own.reduce((sum, d) => sum + d.amountUsd, 0),
        date: closeDates[0] ?? c.renewalDate,
        ownerAccountId: own.find((d) => d.ownerAccountId)?.ownerAccountId ?? c.ownerAccountId,
      };
    })
    .sort(
      (a, b) =>
        b.dealValueUsd - a.dealValueUsd ||
        TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PANEL_CUSTOMERS);
}

// The fallback summary when the model is off or rejected: a sentence built from the
// three signals that contribute most, using only numbers already in the evidence.
export function templateSummary(
  snapshot: ScoredEvidence,
  now: Date,
): { text: string; citedIds: string[] } {
  const tiles = buildTiles(snapshot, now).filter((t) => t.points >= 0.5);
  if (tiles.length === 0) {
    return { text: 'Nothing linked to this issue carries stakes yet.', citedIds: [] };
  }
  const { evidence, raw } = snapshot;
  const deals = openDeals(evidence);
  const requests = factsOf(evidence, 'request');
  const escalated = requests.filter((r) => r.escalated).length;
  const goals = factsOf(evidence, 'goal');

  const phrase: Record<SignalKey, () => string> = {
    R: () =>
      deals.length > 0
        ? `${formatUsd(raw.R ?? 0)} of weighted revenue across ${plural(deals.length, 'open deal')}`
        : `${formatUsd(raw.R ?? 0)} of renewals due within 90 days`,
    S: () =>
      `${plural(requests.length, 'open support request')}${escalated > 0 ? ` (${escalated} escalated)` : ''}`,
    C: () => plural(distinctCustomers(evidence).length, 'linked customer'),
    H: () => `${plural(raw.H ?? 0, 'message')} in the last 30 days`,
    G: () =>
      goals.some((g) => g.status === 'at-risk' || g.status === 'off-track')
        ? 'a linked goal that is at risk'
        : 'a linked company goal',
    U: () => (raw.U === 0 ? 'a date that is due now' : `a date ${plural(raw.U ?? 0, 'day')} away`),
  };

  const parts = tiles.slice(0, 3).map((t) => phrase[t.signal]());
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const citedIds = [...new Set(tiles.slice(0, 3).flatMap((t) => t.evidenceIds))];
  return { text: `Most of this score comes from ${list}.`, citedIds };
}

export function toPanelView(snapshot: Snapshot, now: Date): PanelView {
  return {
    issueKey: snapshot.issueKey,
    score: snapshot.score,
    confidence: snapshot.confidence,
    currentPriority: snapshot.currentPriority,
    suggestedPriority: snapshot.suggestedPriority,
    badges: snapshot.badges,
    summary: {
      text: snapshot.summary.text,
      generated: snapshot.summary.generated,
      sourceCount: snapshot.evidence.length,
    },
    tiles: buildTiles(snapshot, now),
    customers: topCustomers(snapshot.evidence),
    evidence: snapshot.evidence,
    degraded: snapshot.degraded,
    hiddenItems: snapshot.hiddenItems,
    computedAt: snapshot.computedAt,
    hasPendingShipNotice: false,
  };
}
