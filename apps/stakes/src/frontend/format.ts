import {
  formatUsd,
  type Badge,
  type Confidence,
  type EvidenceItem,
  type EvidenceSource,
  type EvidenceType,
  type PanelView,
  type SignalKey,
} from '@stakes/contracts';

export function formatPoints(points: number): string {
  return `+${Math.max(0, Math.round(points))} pts`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export const BADGE_LABEL: Record<Badge, string> = {
  'silent-fire': 'Silent fire',
  phantom: 'Phantom priority',
  'stakes-jump': 'Stakes jump',
};

// Lozenge appearances: amber for a silent fire, grey for a phantom, blue for a jump.
// Every badge also carries its text, so colour is never the only signal.
export const BADGE_APPEARANCE: Record<Badge, 'moved' | 'default' | 'inprogress'> = {
  'silent-fire': 'moved',
  phantom: 'default',
  'stakes-jump': 'inprogress',
};

export function suggestionText(
  view: Pick<PanelView, 'suggestedPriority' | 'currentPriority'>,
): string {
  if (view.suggestedPriority === null) {
    return 'No suggested priority yet: a Jira admin needs to map this band in Stakes settings.';
  }
  if (view.suggestedPriority.toLowerCase() === view.currentPriority.toLowerCase()) {
    return `Priority already matches the score (${view.currentPriority}).`;
  }
  return `Suggested: ${view.suggestedPriority} (now ${view.currentPriority || 'unset'})`;
}

export interface TileText {
  label: string;
  value: string;
  detail: string;
  points: string;
  evidenceCount: number;
}

export function formatTile(view: Pick<PanelView, 'tiles'>, signal: SignalKey): TileText | null {
  const tile = view.tiles.find((t) => t.signal === signal);
  if (!tile) return null;
  return {
    label: tile.label,
    value: tile.rawDisplay,
    detail: tile.detail,
    points: formatPoints(tile.points),
    evidenceCount: tile.evidenceIds.length,
  };
}

export function relativeTime(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  'teamwork-graph': 'Teamwork Graph',
  'jira-rest': 'Jira',
  mirror: 'Stakes import',
  bridge: 'Stakes bridge',
};

const GROUPS: Array<{ label: string; types: EvidenceType[] }> = [
  { label: 'Deals', types: ['deal'] },
  { label: 'Customers', types: ['customer'] },
  { label: 'Support requests', types: ['escalation', 'jsm_request'] },
  { label: 'Conversations', types: ['conversation'] },
  { label: 'Goals', types: ['goal'] },
];

export interface EvidenceGroup {
  label: string;
  items: EvidenceItem[];
}

// The drawer groups evidence by kind, escalations first among requests. When a tile is
// selected, only that tile's items are shown.
export function groupEvidence(
  evidence: EvidenceItem[],
  only: string[] | null = null,
): EvidenceGroup[] {
  const keep = only ? new Set(only) : null;
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.types.flatMap((t) =>
      evidence.filter((e) => e.type === t && (!keep || keep.has(e.id))),
    ),
  })).filter((g) => g.items.length > 0);
}

export function evidenceValue(item: EvidenceItem): string {
  if (item.value === null) return '';
  if (item.unit === 'USD') return formatUsd(item.value);
  if (item.type === 'customer') return `${item.value} pts`;
  if (item.unit === 'count') return String(item.value);
  return String(Math.round(item.value * 10) / 10);
}

export interface Notice {
  appearance: 'information' | 'warning';
  text: string;
}

// Problems with the data lower confidence and say so; they never replace the panel
// with an error.
export function panelNotices(
  view: Pick<PanelView, 'confidence' | 'degraded' | 'hiddenItems' | 'evidence'>,
): Notice[] {
  const notices: Notice[] = [];
  if (view.degraded.includes('teamwork-graph')) {
    notices.push({
      appearance: 'warning',
      text: 'Teamwork Graph signals are unavailable. The score uses the other sources; select Refresh to retry.',
    });
  }
  if (view.degraded.includes('jira-rest')) {
    notices.push({
      appearance: 'warning',
      text: 'Linked support requests could not be read just now. Select Refresh to retry.',
    });
  }
  if (view.hiddenItems > 0) {
    notices.push({
      appearance: 'information',
      text: "You don't have access to some linked items, so they aren't counted. Ask a Jira admin for access if you need them included.",
    });
  }
  if (view.confidence === 'low' && view.evidence.length > 0) {
    notices.push({
      appearance: 'information',
      text: 'Based on limited evidence. Link more customers, deals, requests or goals, then select Refresh.',
    });
  }
  return notices;
}

export type SummarySegment =
  { kind: 'text'; text: string } | { kind: 'cite'; n: number; url: string; title: string };

// Citations such as [ev-deal-DEAL-031] become numbered links to the evidence they name,
// so a reader can check every claim in one click. Numbers follow first appearance.
export function summarySegments(text: string, evidence: EvidenceItem[]): SummarySegment[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const numbers = new Map<string, number>();
  const out: SummarySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\s*\[([^\]]*\bev-[^\]]*)\]/g)) {
    if (match.index! > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    for (const id of match[1]!.split(/[\s,;]+/)) {
      const item = byId.get(id);
      if (!item) continue;
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
      out.push({ kind: 'cite', n: numbers.get(id)!, url: item.url, title: item.title });
    }
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function summarySourceText(summary: PanelView['summary']): string {
  return summary.generated
    ? `Generated from ${summary.sourceCount} ${summary.sourceCount === 1 ? 'source' : 'sources'}`
    : `Summary from ${summary.sourceCount} evidence ${summary.sourceCount === 1 ? 'item' : 'items'}`;
}
