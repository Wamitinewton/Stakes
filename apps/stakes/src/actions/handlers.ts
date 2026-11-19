import { z } from 'zod';
import {
  IssueKey,
  ProjectKey,
  formatDate,
  formatUsd,
  type Badge,
  type EvidenceItem,
  type Snapshot,
} from '@stakes/contracts';
import { toPanelView } from '../core/panelView.js';
import { err, ok, type Result } from '../core/result.js';
import type { JiraReader } from '../adapters/jira.js';
import type { HistoryStore, SettingsStore } from '../adapters/storage.js';
import { getCustomerExposure, searchCustomers, type CustomerDeps } from '../services/customers.js';
import { getStakes, type GetStakesDeps } from '../services/getStakes.js';
import { getHistory, getProjectTrend } from '../services/history.js';
import { listBacklog, type BacklogDeps } from '../services/rankBacklog.js';
import { releaseStakes, type ReleaseDeps } from '../services/releaseStakes.js';
import { draftCustomer, type ShipNoticeDeps } from '../services/shipNotice.js';
import { planSprint, sprintOptions, type PlanSprintDeps } from '../services/planSprint.js';
import { parseInput } from '../resolvers/context.js';

// Every action is read-only and runs as the person asking, so Rovo and MCP answers
// never include an issue, request or customer that person could not open in Jira.
// Each one validates its inputs, calls one service and returns plain JSON with the
// links an agent should quote.

export interface ActionDeps {
  jira: Pick<JiraReader, 'canView' | 'issue' | 'displayNames' | 'projects' | 'openIssues'>;
  stakes: GetStakesDeps;
  backlog: BacklogDeps;
  release: ReleaseDeps;
  customers: CustomerDeps;
  shipNotice: ShipNoticeDeps;
  settings: Pick<SettingsStore, 'get'>;
  history: Pick<HistoryStore, 'projectSince'>;
  plan: PlanSprintDeps;
  siteUrl: string;
  clock: () => Date;
}

export interface Source {
  title: string;
  url: string;
}

const BADGE_TEXT: Record<Badge, string> = {
  'silent-fire': 'Silent fire (high stakes, low priority)',
  phantom: 'Phantom priority (high priority, no evidence)',
  'stakes-jump': 'Stakes jump this week',
};

const NUMBERS_NOTE =
  'Report only the numbers in this result. Do not estimate, round up or add figures.';

const issueKey = z.string().trim().toUpperCase().pipe(IssueKey);
const projectKey = z.string().trim().toUpperCase().pipe(ProjectKey);
// Rovo may pass numbers as strings.
const limit = z.coerce.number().int().min(1).max(25).default(10);

async function names(deps: ActionDeps, ids: Array<string | null | undefined>) {
  return deps.jira
    .displayNames(ids.filter((id): id is string => typeof id === 'string' && id !== ''))
    .catch(() => new Map<string, string>());
}

function displayValue(e: EvidenceItem): string | null {
  if (e.value === null) return null;
  if (e.unit === 'USD') return formatUsd(e.value);
  return String(Math.round(e.value * 10) / 10);
}

// The evidence behind the biggest contributions first, largest values first within
// each, so the ten an agent sees are the ten that matter most.
export function topEvidence(snapshot: Snapshot, now: Date, count = 10): EvidenceItem[] {
  const tiles = toPanelView(snapshot, now).tiles;
  const rank = new Map<string, number>();
  tiles.forEach((t, i) => t.evidenceIds.forEach((id) => rank.has(id) || rank.set(id, i)));
  return [...snapshot.evidence]
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? tiles.length) - (rank.get(b.id) ?? tiles.length) ||
        (b.value ?? 0) - (a.value ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, count);
}

// ---------------------------------------------------------------------------------

const IssueInput = z.object({ issueKey });

export async function getIssueStakesAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(IssueInput, payload);
  if (!parsed.ok) return parsed;
  const key = parsed.data.issueKey;
  if (!(await deps.jira.canView(key))) {
    return err('FORBIDDEN', `${key} does not exist or you cannot view it`);
  }
  const [issue, stakes] = await Promise.all([
    deps.jira.issue(key),
    getStakes(deps.stakes, key, { refresh: false }),
  ]);
  if (!issue || !stakes.ok) return err('NOT_FOUND', `${key} does not exist or you cannot view it`);

  const now = deps.clock();
  const view = toPanelView(stakes.data, now);
  const people = await names(deps, [
    issue.assigneeAccountId,
    ...view.customers.map((c) => c.ownerAccountId),
  ]);
  const evidence = topEvidence(stakes.data, now);
  const issueSource = { title: `${key} in Jira`, url: issue.url };
  return ok({
    issueKey: key,
    summary: issue.summary,
    status: issue.status,
    assignee: issue.assigneeAccountId ? (people.get(issue.assigneeAccountId) ?? null) : null,
    fixVersions: issue.fixVersions,
    score: view.score,
    confidence: view.confidence,
    currentPriority: view.currentPriority,
    suggestedPriority: view.suggestedPriority,
    badges: view.badges.map((b) => BADGE_TEXT[b]),
    whyItMatters: stakes.data.summary.text,
    signals: view.tiles.map((t) => ({
      signal: t.label,
      value: t.rawDisplay,
      detail: t.detail,
      points: Math.round(t.points),
    })),
    customers: view.customers.map((c) => ({
      name: c.name,
      tier: c.tier,
      dealValue: c.dealValueUsd > 0 ? formatUsd(c.dealValueUsd) : null,
      closesOrRenews: c.date ? formatDate(c.date) : null,
      owner: c.ownerAccountId ? (people.get(c.ownerAccountId) ?? null) : null,
    })),
    evidence: evidence.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      value: displayValue(e),
      detail: e.detail,
      url: e.url,
    })),
    degradedSources: view.degraded,
    computedAt: view.computedAt,
    note: `${NUMBERS_NOTE} To change the priority, open the Stakes panel on ${key}.`,
    sources: [issueSource, ...evidence.map((e) => ({ title: e.title, url: e.url }))],
  });
}

// ---------------------------------------------------------------------------------

const BacklogInput = z.object({
  projectKey,
  limit,
  filter: z.enum(['all', 'silent-fires', 'phantoms']).default('all'),
});

export async function rankBacklogAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(BacklogInput, payload);
  if (!parsed.ok) return parsed;
  const { projectKey: project, filter } = parsed.data;
  const list = await listBacklog(deps.backlog, project);
  const keep = (badges: Badge[]) =>
    filter === 'silent-fires'
      ? badges.includes('silent-fire')
      : filter === 'phantoms'
        ? badges.includes('phantom')
        : true;
  const rows = list.rows.filter((r) => keep(r.badges)).slice(0, parsed.data.limit);
  return ok({
    projectKey: project,
    filter,
    openIssues: list.summary.total,
    scored: list.summary.scored,
    silentFires: list.summary.silentFires,
    phantoms: list.summary.phantoms,
    issues: rows.map((r, i) => ({
      rank: i + 1,
      issueKey: r.issueKey,
      summary: r.summary,
      score: r.score,
      currentPriority: r.currentPriority,
      suggestedPriority: r.suggestedPriority,
      badges: r.badges.map((b) => BADGE_TEXT[b]),
      revenueAtRisk: r.revenueUsd > 0 ? formatUsd(r.revenueUsd) : null,
      customers: r.customerNames,
      supportRequests: r.tickets,
      url: r.issueUrl,
    })),
    note:
      list.staleKeys.length > 0
        ? `${list.staleKeys.length} issues have no fresh score; open the Stakes page in ${project} to score them. ${NUMBERS_NOTE}`
        : NUMBERS_NOTE,
    sources: rows.map((r) => ({ title: `${r.issueKey} · ${r.summary}`, url: r.issueUrl })),
  });
}

// ---------------------------------------------------------------------------------

const CustomerInput = z.object({ customer: z.string().trim().min(1).max(100) });

const titleCase = (s: string) =>
  s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export async function findCustomerExposureAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(CustomerInput, payload);
  if (!parsed.ok) return parsed;
  const query = parsed.data.customer;

  // Names are stored as imported and the search matches a prefix, so try the words
  // as typed and then in title case ("kilima freight" → "Kilima Freight").
  let found = (await searchCustomers(deps.customers, query)).customers;
  if (found.length === 0 && titleCase(query) !== query) {
    found = (await searchCustomers(deps.customers, titleCase(query))).customers;
  }
  if (found.length === 0) {
    return err('NOT_FOUND', `No customer named "${query}" is in Stakes. Check the spelling.`);
  }
  const exact = found.find((c) => c.name.toLowerCase() === query.toLowerCase() || c.id === query);
  if (!exact && found.length > 1) {
    return ok({
      matches: found.slice(0, 10).map((c) => ({ id: c.id, name: c.name })),
      note: 'Several customers match. Ask the user which one they mean, then call again with its name or id.',
      sources: [],
    });
  }
  const target = exact ?? found[0]!;
  const exposure = await getCustomerExposure(deps.customers, target.id);
  if (!exposure) return err('NOT_FOUND', `No customer named "${query}" is in Stakes.`);

  const people = await names(deps, [
    exposure.ownerAccountId,
    ...exposure.issues.map((i) => i.assigneeAccountId),
  ]);
  return ok({
    customer: {
      id: exposure.id,
      name: exposure.name,
      tier: exposure.tier,
      annualRevenue: formatUsd(exposure.arrUsd),
      renewalDate: exposure.renewalDate ? formatDate(exposure.renewalDate) : null,
      accountOwner: exposure.ownerAccountId ? (people.get(exposure.ownerAccountId) ?? null) : null,
    },
    dealValueAtRisk: formatUsd(exposure.dealValueAtRiskUsd),
    openIssues: exposure.issues.map((i) => ({
      issueKey: i.key,
      summary: i.summary,
      status: i.status,
      assignee: i.assigneeAccountId ? (people.get(i.assigneeAccountId) ?? null) : null,
      targetVersions: i.fixVersions,
      score: i.score,
      url: i.url,
    })),
    note: `Only issues you can open in Jira are listed. ${NUMBERS_NOTE}`,
    sources: exposure.issues.map((i) => ({ title: `${i.key} · ${i.summary}`, url: i.url })),
  });
}

// ---------------------------------------------------------------------------------

const ReleaseInput = z.object({
  version: z.string().trim().min(1).max(100),
  projectKey: projectKey.optional(),
});

const MAX_RELEASE_PROJECTS = 20;

export async function getReleaseStakesAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(ReleaseInput, payload);
  if (!parsed.ok) return parsed;
  const wanted = parsed.data.version.toLowerCase();

  // A question like "what does 2026.12 unblock?" names no project, so look in the
  // projects Stakes is set up for, then in every software project.
  let projects = parsed.data.projectKey ? [parsed.data.projectKey] : [];
  if (projects.length === 0) projects = (await deps.settings.get()).projectsInScope;
  if (projects.length === 0) {
    projects = (await deps.jira.projects().catch(() => []))
      .filter((p) => p.type === 'software')
      .map((p) => p.key);
  }

  for (const project of projects.slice(0, MAX_RELEASE_PROJECTS)) {
    const listing = await releaseStakes(deps.release, project).catch(() => null);
    const version = listing?.versions.find((v) => v.name.toLowerCase() === wanted);
    if (!version) continue;
    const view = (await releaseStakes(deps.release, project, version.id))!;
    const total = view.deals.reduce((sum, d) => sum + d.amountUsd, 0);
    return ok({
      projectKey: project,
      version: version.name,
      revenueUnblocked: formatUsd(total),
      openDeals: view.deals.length,
      customersServed: view.customers.map((c) => c.name),
      issues: view.issues.map((i) => ({
        issueKey: i.issueKey,
        summary: i.summary,
        score: i.score,
        url: i.url,
      })),
      note: `Revenue unblocked is the full value of the open deals linked to the version's unfinished issues. ${NUMBERS_NOTE}`,
      sources: view.issues.map((i) => ({ title: `${i.issueKey} · ${i.summary}`, url: i.url })),
    });
  }
  return err(
    'NOT_FOUND',
    `No unreleased version named "${parsed.data.version}" was found${parsed.data.projectKey ? ` in ${parsed.data.projectKey}` : ''}.`,
  );
}

// ---------------------------------------------------------------------------------

const DraftInput = z.object({
  issueKey,
  customer: z.string().trim().min(1).max(100).optional(),
  tone: z.enum(['brief', 'detailed']).default('brief'),
});

export async function draftCustomerUpdateAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(DraftInput, payload);
  if (!parsed.ok) return parsed;
  const { issueKey: key, customer, tone } = parsed.data;
  if (!(await deps.jira.canView(key))) {
    return err('FORBIDDEN', `${key} does not exist or you cannot view it`);
  }

  let customerId: string | undefined;
  let customerName: string | null = null;
  if (customer) {
    const stakes = await getStakes(deps.stakes, key, { refresh: false });
    if (!stakes.ok) return stakes;
    const linked = stakes.data.evidence.flatMap((e) =>
      e.facts.kind === 'customer' ? [e.facts] : [],
    );
    const match = linked.find(
      (c) => c.customerId === customer || c.name.toLowerCase() === customer.toLowerCase(),
    );
    if (!match) {
      return err(
        'NOT_FOUND',
        `${customer} is not linked to ${key}. Linked customers: ${[...new Set(linked.map((c) => c.name))].join(', ') || 'none'}.`,
      );
    }
    customerId = match.customerId;
    customerName = match.name;
  }

  const draft = await draftCustomer(deps.shipNotice, { issueKey: key, customerId, tone });
  if (!draft.ok) return draft;
  const url = `${deps.siteUrl}/browse/${key}`;
  return ok({
    issueKey: key,
    customer: customerName,
    tone,
    draft: draft.data.text,
    generated: draft.data.generated,
    evidenceIdsUsed: draft.data.citedIds,
    note: 'This is a draft for a person to review. Nothing was sent. Show it as written; do not add figures.',
    sources: [{ title: `${key} in Jira`, url }],
  });
}

// ---------------------------------------------------------------------------------

const TrendInput = z
  .object({ issueKey: issueKey.optional(), projectKey: projectKey.optional() })
  .refine((v) => v.issueKey || v.projectKey, 'Give an issueKey or a projectKey');

export async function getScoreTrendAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(TrendInput, payload);
  if (!parsed.ok) return parsed;
  if (parsed.data.issueKey) {
    const key = parsed.data.issueKey;
    if (!(await deps.jira.canView(key))) {
      return err('FORBIDDEN', `${key} does not exist or you cannot view it`);
    }
    const history = await getHistory(deps.stakes, { issueKey: key, days: 30 });
    const first = history.points[0]?.score ?? null;
    const last = history.points.at(-1)?.score ?? null;
    const url = `${deps.siteUrl}/browse/${key}`;
    return ok({
      issueKey: key,
      days: 30,
      points: history.points,
      first,
      last,
      change: first !== null && last !== null ? last - first : null,
      stakesJump: history.jump,
      note:
        history.points.length === 0
          ? 'No score history yet; the issue has not been scored in the last 30 days.'
          : NUMBERS_NOTE,
      sources: [{ title: `${key} in Jira`, url }],
    });
  }
  const project = parsed.data.projectKey!;
  const trends = (
    await getProjectTrend(
      { history: deps.history, jira: deps.jira, clock: deps.clock },
      { projectKey: project, days: 30 },
    )
  ).slice(0, 10);
  return ok({
    projectKey: project,
    days: 30,
    movers: trends.map((t) => ({ ...t, url: `${deps.siteUrl}/browse/${t.issueKey}` })),
    note: NUMBERS_NOTE,
    sources: trends.map((t) => ({
      title: t.issueKey,
      url: `${deps.siteUrl}/browse/${t.issueKey}`,
    })),
  });
}

// ---------------------------------------------------------------------------------

const SprintInput = z.object({
  projectKey,
  sprint: z.string().trim().min(1).max(100),
  capacity: z.coerce.number().min(0).max(1000).optional(),
});

export async function suggestSprintScopeAction(deps: ActionDeps, payload: unknown) {
  const parsed = parseInput(SprintInput, payload);
  if (!parsed.ok) return parsed;
  const input = parsed.data;
  const options = await sprintOptions(deps.plan, input.projectKey);
  const match = options.boards
    .flatMap((board) =>
      board.futureSprints
        .filter((sprint) => sprint.name.toLowerCase() === input.sprint.toLowerCase())
        .map((sprint) => ({ board, sprint })),
    )
    .sort((a, b) => a.board.id - b.board.id || a.sprint.id - b.sprint.id)[0];
  if (!match) {
    return ok({
      available: false,
      note: `No future sprint named ${input.sprint} is available on a ${input.projectKey} board.`,
      sources: [],
    });
  }
  const plan = await planSprint(deps.plan, {
    boardId: match.board.id,
    sprintId: match.sprint.id,
    ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
  });
  if (!plan) return err('NOT_FOUND', `${input.sprint} is not a future sprint`);
  return ok({
    available: true,
    board: match.board.name,
    sprint: plan.sprintName,
    capacity: plan.capacity,
    defaultCapacity: plan.defaultCapacity,
    pointsUsed: plan.pointsUsed,
    scoreCovered: plan.scoreCovered,
    revenueUsd: plan.revenueUsd,
    issues: plan.issues.map((issue) => ({
      ...issue,
      url: `${deps.siteUrl}/browse/${issue.issueKey}`,
    })),
    needsEstimate: plan.needsEstimate,
    note: `${NUMBERS_NOTE} Apply the proposal from the Sprint plan tab in Stakes.`,
    sources: plan.issues.map((issue) => ({
      title: issue.issueKey,
      url: `${deps.siteUrl}/browse/${issue.issueKey}`,
    })),
  });
}

export type ActionResult = Result<unknown>;
