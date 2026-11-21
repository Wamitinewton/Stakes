import type { EvidenceItem, GoalStatus, Tier } from '@stakes/contracts';
import { addDays, daysBetween, isoDay } from './dates';
import {
  conversationEvidence,
  customerEvidence,
  dealEvidence,
  goalEvidence,
  requestEvidence,
} from './evidence';
import { isClosedStage } from './csv';
import { customerUrl, dealUrl } from './links';
import type { P95 } from './normalise';

// The Orbit Pay demo dataset. Every date in the files is written as if today were the
// anchor date; the seeder moves them all by the days between the anchor and the day it
// runs, so the story (a deal closing in 25 days, a ticket open for 15) reads the same
// whenever someone installs the app.

export interface DemoProject {
  anchorDate: string;
  label: string;
  version: { name: string; releaseDate: string };
  sprints: Array<{ id: 'active' | 'future'; name: string; startDate: string; endDate: string }>;
  percentiles: P95 & { scoredCount: number };
}

export interface DemoCustomer {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
}

export interface DemoDeal {
  id: string;
  name: string;
  customerId: string;
  amountUsd: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  issueKeys: string[];
}

export interface DemoIssue {
  key: string;
  type: 'Bug' | 'Story' | 'Task';
  summary: string;
  priority: string;
  storyPoints: number;
  fixVersion?: boolean;
  sprint?: 'active' | 'future';
  customers?: string[];
  // Scores for the 30 days before seeding, oldest first, for issues whose story needs a
  // trend; every other issue gets a flat line at its seeded score.
  history?: number[];
}

export interface DemoRequest {
  key: string;
  summary: string;
  priority: string;
  ageDays: number;
  escalated: boolean;
  linkedIssue: string;
}

export interface DemoMessage {
  id: string;
  issueKey: string;
  channel: string;
  author: string;
  text: string;
  daysAgo: number;
}

export interface DemoGoal {
  issueKey: string;
  name: string;
  status: GoalStatus;
}

export interface DemoData {
  project: DemoProject;
  customers: DemoCustomer[];
  deals: DemoDeal[];
  issues: DemoIssue[];
  requests: DemoRequest[];
  messages: DemoMessage[];
  goals: DemoGoal[];
}

export const DEMO_HISTORY_DAYS = 30;

export function demoOffsetDays(data: DemoData, seededAt: Date): number {
  return daysBetween(new Date(`${data.project.anchorDate}T00:00:00Z`), seededAt);
}

export function shiftDate(date: string | null, offsetDays: number): string | null {
  if (date === null) return null;
  return isoDay(addDays(new Date(`${date}T00:00:00Z`), offsetDays));
}

// A request's age is kept by stamping it with a creation time that many days before
// the seed, at the seed's time of day.
export function demoRequestCreatedAt(request: DemoRequest, seededAt: Date): string {
  return addDays(seededAt, -request.ageDays).toISOString();
}

export function demoMessageAt(message: DemoMessage, seededAt: Date): string {
  return addDays(seededAt, -message.daysAgo).toISOString();
}

// Mirror rows, shaped like the entity-store rows. Owners are the admin who loaded the
// demo, so mentions and ship notices reach a real person on the site.
export function demoMirrorRows(
  data: DemoData,
  opts: {
    seededAt: Date;
    ownerAccountId: string;
    keyFor: (storyKey: string) => string;
    siteUrl: string;
  },
) {
  const offset = demoOffsetDays(data, opts.seededAt);
  return {
    customers: data.customers.map((c) => ({
      ...c,
      renewalDate: shiftDate(c.renewalDate, offset),
      ownerAccountId: opts.ownerAccountId,
      source: 'demo' as const,
    })),
    deals: data.deals.map((d) => ({
      ...d,
      closeDate: shiftDate(d.closeDate, offset),
      closed: isClosedStage(d.stage),
      ownerAccountId: opts.ownerAccountId,
      issueKeys: d.issueKeys.map(opts.keyFor),
      source: 'demo' as const,
    })),
    customerLinks: data.issues.flatMap((i) =>
      (i.customers ?? []).map((customerId) => ({
        customerId,
        issueKey: opts.keyFor(i.key),
        source: 'demo' as const,
      })),
    ),
    messages: data.messages.map((m) => ({
      id: m.id,
      issueKey: opts.keyFor(m.issueKey),
      channel: m.channel,
      author: m.author,
      text: m.text,
      at: demoMessageAt(m, opts.seededAt),
      url: `${opts.siteUrl}/browse/${opts.keyFor(m.issueKey)}`,
      source: 'demo' as const,
    })),
  };
}

// The evidence the collector would assemble for one demo issue, built with the same
// builders and the same mirror rows. Goals are only included when asked for, because
// the seeder cannot create them; the admin links the goal by hand.
export function demoEvidence(
  data: DemoData,
  storyKey: string,
  opts: { seededAt: Date; now: Date; siteUrl?: string; withGoals: boolean },
): EvidenceItem[] {
  const siteUrl = opts.siteUrl ?? '';
  const at = opts.now.toISOString();
  const rows = demoMirrorRows(data, {
    seededAt: opts.seededAt,
    ownerAccountId: 'demo-owner',
    keyFor: (k) => k,
    siteUrl,
  });
  const customers = new Map(rows.customers.map((c) => [c.id, c]));
  const deals = rows.deals.filter((d) => d.issueKeys.includes(storyKey));
  const customerIds = new Set([
    ...deals.map((d) => d.customerId),
    ...rows.customerLinks.filter((l) => l.issueKey === storyKey).map((l) => l.customerId),
  ]);

  const evidence: EvidenceItem[] = [
    ...deals.map((d) =>
      dealEvidence(
        {
          ...d,
          customerName: customers.get(d.customerId)?.name ?? null,
          url: dealUrl(siteUrl, d.id),
        },
        'mirror',
        at,
      ),
    ),
    ...[...customerIds]
      .map((id) => customers.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => customerEvidence({ ...c, url: customerUrl(siteUrl, c.id) }, 'mirror', at)),
    ...data.requests
      .filter((r) => r.linkedIssue === storyKey)
      .map((r) =>
        requestEvidence(
          {
            key: r.key,
            summary: r.summary,
            priority: r.priority,
            createdAt: demoRequestCreatedAt(r, opts.seededAt),
            slaBreachAt: null,
            escalated: r.escalated,
            assigneeAccountId: null,
            url: `${siteUrl}/browse/${r.key}`,
          },
          opts.now,
          at,
        ),
      ),
    ...rows.messages
      .filter((m) => m.issueKey === storyKey)
      .map((m) => conversationEvidence(m, 'mirror', at)),
  ];
  if (opts.withGoals) {
    for (const g of data.goals.filter((goal) => goal.issueKey === storyKey)) {
      evidence.push(
        goalEvidence({ id: `demo-${g.name}`, name: g.name, status: g.status, url: '' }, at),
      );
    }
  }
  return evidence;
}
