import type { EvidenceItem, EvidenceSource, IssueKey } from '@stakes/contracts';
import {
  conversationEvidence,
  customerEvidence,
  dealEvidence,
  goalEvidence,
  probabilityForStage,
  requestEvidence,
} from '../core/evidence.js';
import { customerUrl, dealUrl } from '../core/links.js';
import { CONVERSATION_WINDOW_DAYS } from '../core/signals.js';
import type { GraphReader } from '../adapters/graph.js';
import type { JiraReader } from '../adapters/jira.js';
import type { MirrorCustomer, MirrorDeal, MirrorStore } from '../adapters/storage.js';

export interface CollectDeps {
  graph: Pick<GraphReader, 'dealsForIssue' | 'conversationsForIssue' | 'goalsForIssue'>;
  jira: Pick<JiraReader, 'linkedRequests' | 'bridgeCrm'>;
  mirror: Pick<
    MirrorStore,
    'dealsForIssue' | 'customersForIssue' | 'customersByIds' | 'messagesForIssue'
  >;
  siteUrl: string;
  clock: () => Date;
}

export interface Collected {
  evidence: EvidenceItem[];
  degraded: EvidenceSource[];
  hiddenItems: number;
  dealSource: EvidenceSource | null;
}

type Settled<T> = { ok: true; value: T } | { ok: false };

// One failing source must not take the panel down; it is recorded and the score is
// built from whatever else answered.
async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    console.warn('evidence source failed', { name: e instanceof Error ? e.name : 'unknown' });
    return { ok: false };
  }
}

const graphAnswered = <T>(r: Settled<{ ok: boolean; data?: T }>): T | null =>
  r.ok && r.value.ok ? (r.value.data as T) : null;

export async function collectEvidence(
  deps: CollectDeps,
  issue: { key: IssueKey; id: string },
): Promise<Collected> {
  const now = deps.clock();
  const at = now.toISOString();
  const degraded = new Set<EvidenceSource>();
  const evidence: EvidenceItem[] = [];

  const [q1, bridge, mirrorDeals, directCustomers, requests, q3, messages, q4] = await Promise.all([
    settle(() => deps.graph.dealsForIssue(issue)),
    settle(() => deps.jira.bridgeCrm(issue.key)),
    settle(() => deps.mirror.dealsForIssue(issue.key)),
    settle(() => deps.mirror.customersForIssue(issue.key)),
    settle(() => deps.jira.linkedRequests(issue.key)),
    settle(() => deps.graph.conversationsForIssue(issue, CONVERSATION_WINDOW_DAYS)),
    settle(() => deps.mirror.messagesForIssue(issue.key)),
    settle(() => deps.graph.goalsForIssue(issue)),
  ]);

  // Deals: the first source that has any wins, in the order graph, bridge property,
  // mirror. Later sources are fallbacks for the same facts, not extra evidence.
  const mirrorDealList: MirrorDeal[] = mirrorDeals.ok ? mirrorDeals.value : [];
  const graphDeals = graphAnswered(q1) ?? [];
  const bridgeDeals = bridge.ok && bridge.value ? bridge.value.deals : [];
  let dealSource: EvidenceSource | null = null;
  const customerIds = new Set<string>();

  if (graphDeals.length > 0) {
    dealSource = 'teamwork-graph';
    const byId = new Map(mirrorDealList.map((d) => [d.id, d]));
    for (const g of graphDeals) {
      const m = byId.get(g.id);
      if (m) customerIds.add(m.customerId);
      evidence.push(
        dealEvidence(
          {
            id: g.id,
            name: g.name,
            customerId: m?.customerId ?? null,
            customerName: g.accountName,
            amountUsd: g.amountUsd,
            probability: m?.probability ?? probabilityForStage(g.stage),
            stage: g.stage,
            closeDate: g.closeDate,
            closed: g.closed,
            ownerAccountId: m?.ownerAccountId ?? null,
            url: g.url || dealUrl(deps.siteUrl, g.id),
          },
          'teamwork-graph',
          at,
        ),
      );
    }
  } else if (bridgeDeals.length > 0) {
    dealSource = 'bridge';
    for (const d of bridgeDeals) {
      evidence.push(
        dealEvidence(
          {
            id: d.id,
            name: d.name,
            customerId: d.customer.id,
            customerName: d.customer.name,
            amountUsd: d.amountUsd,
            probability: d.probability,
            stage: d.stage,
            closeDate: d.closeDate,
            closed: /closed/i.test(d.stage),
            ownerAccountId: d.ownerAccountId,
            url: dealUrl(deps.siteUrl, d.id),
          },
          'bridge',
          at,
        ),
      );
    }
    // The bridge carries tier but no ARR or renewal date for its customers.
    const seen = new Set<string>();
    for (const d of bridgeDeals) {
      if (seen.has(d.customer.id)) continue;
      seen.add(d.customer.id);
      evidence.push(
        customerEvidence(
          {
            ...d.customer,
            arrUsd: 0,
            renewalDate: null,
            ownerAccountId: d.ownerAccountId,
            url: customerUrl(deps.siteUrl, d.customer.id),
          },
          'bridge',
          at,
        ),
      );
    }
  } else if (mirrorDealList.length > 0) {
    dealSource = 'mirror';
    for (const d of mirrorDealList) customerIds.add(d.customerId);
  } else if (!graphAnswered(q1)) {
    degraded.add('teamwork-graph');
  }
  if (!mirrorDeals.ok) degraded.add('mirror');

  // Mirror customers: those behind the chosen deals plus any linked to the issue directly.
  let customers: MirrorCustomer[] = directCustomers.ok ? directCustomers.value : [];
  if (!directCustomers.ok) degraded.add('mirror');
  if (customerIds.size > 0) {
    const viaDeals = await settle(() => deps.mirror.customersByIds([...customerIds]));
    if (viaDeals.ok) customers = [...customers, ...viaDeals.value];
    else degraded.add('mirror');
  }
  const customerById = new Map(customers.map((c) => [c.id, c]));

  if (dealSource === 'mirror') {
    for (const d of mirrorDealList) {
      evidence.push(
        dealEvidence(
          {
            ...d,
            customerName: customerById.get(d.customerId)?.name ?? null,
            url: dealUrl(deps.siteUrl, d.id),
          },
          'mirror',
          at,
        ),
      );
    }
  }
  for (const c of customerById.values()) {
    evidence.push(customerEvidence({ ...c, url: customerUrl(deps.siteUrl, c.id) }, 'mirror', at));
  }

  let hiddenItems = 0;
  if (requests.ok) {
    hiddenItems = requests.value.hidden;
    for (const r of requests.value.requests) evidence.push(requestEvidence(r, now, at));
  } else degraded.add('jira-rest');

  // Conversations: graph messages and demo messages from the mirror together; the graph
  // only counts as degraded when nothing else could stand in for it.
  const graphConversations = graphAnswered(q3);
  for (const c of graphConversations ?? []) {
    evidence.push(
      conversationEvidence(
        { id: c.id, channel: c.title || null, author: null, text: '', at: c.at, url: c.url },
        'teamwork-graph',
        at,
      ),
    );
  }
  const mirrorMessages = messages.ok ? messages.value : [];
  for (const m of mirrorMessages) evidence.push(conversationEvidence(m, 'mirror', at));
  if (!graphConversations && mirrorMessages.length === 0) degraded.add('teamwork-graph');

  const goals = graphAnswered(q4);
  if (goals) for (const g of goals) evidence.push(goalEvidence(g, at));
  else degraded.add('teamwork-graph');

  return { evidence: dedupeById(evidence), degraded: [...degraded], hiddenItems, dealSource };
}

function dedupeById(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Map<string, EvidenceItem>();
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
