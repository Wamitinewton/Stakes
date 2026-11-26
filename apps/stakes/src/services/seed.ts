import type { SeedStatus } from '@stakes/contracts';
import { addDays, isoDay } from '../core/dates';
import {
  DEMO_HISTORY_DAYS,
  demoEvidence,
  demoMirrorRows,
  demoOffsetDays,
  demoRequestCreatedAt,
  shiftDate,
  type DemoData,
  type DemoIssue,
} from '../core/demo';
import { normalise } from '../core/normalise';
import { err, ok, type Result } from '../core/result';
import { DEFAULT_WEIGHTS, score } from '../core/score';
import { rawSignals } from '../core/signals';
import type { Connector } from '../adapters/connector';
import { CUSTOMER_ORG_TYPE, DEAL_TYPE } from '../adapters/connector';
import type { StakesScoreField } from '../adapters/field';
import { DEMO_REQUEST_PROPERTY, JiraError } from '../adapters/jira';
import type { JiraWriter, NewIssue } from '../adapters/jiraWriter';
import {
  EMPTY_SEED_STATUS,
  type ConnectionStore,
  type HistoryStore,
  type MirrorStore,
  type PercentileStore,
  type SeedStore,
  type SnapshotStore,
} from '../adapters/storage';
import { needsConsent } from '../core/consent';

export type SeedStep =
  | 'prepare'
  | 'version'
  | 'issues'
  | 'fillers'
  | 'requests'
  | 'sprints'
  | 'crm'
  | 'history'
  | 'done';

export type RemoveStep = 'issues' | 'extras' | 'connector' | 'storage' | 'done';

interface Slot {
  // The story key this slot creates, or null for a placeholder that only advances the
  // project's issue counter and is deleted again.
  storyKey: string | null;
}

export interface SeedRecord {
  softwareProjectKey: string;
  serviceProjectKey: string;
  accountId: string;
  seededAt: string;
  step: SeedStep;
  plan: {
    projectId: string;
    issueTypeIds: Record<DemoIssue['type'], string>;
    pointsFieldId: string | null;
    serviceDeskId: string;
    requestTypeId: string;
    boardId: number | null;
  } | null;
  versionId: string | null;
  sprintIds: Partial<Record<'active' | 'future', number>>;
  slots: Slot[] | null;
  slotCursor: number;
  keyMap: Record<string, string>;
  createdKeys: string[];
  fillerKeys: string[];
  fillersDeleted: number;
  requestKeys: Record<string, string>;
  requestsDone: number;
  connector: { connectionId: string | null; customerIds: string[]; dealIds: string[] };
  removeStep: RemoveStep | null;
  pendingDeletes: string[] | null;
  removed: { issues: number; customers: number; deals: number; history: number };
}

export interface SeedDeps {
  writer: JiraWriter;
  mirror: Pick<
    MirrorStore,
    | 'upsertCustomers'
    | 'upsertDeals'
    | 'linkCustomers'
    | 'upsertMessages'
    | 'deleteBySource'
    | 'bumpDealsVersion'
  >;
  history: Pick<HistoryStore, 'recordMany' | 'deleteDemo'>;
  percentiles: Pick<PercentileStore, 'get' | 'save' | 'delete'>;
  snapshots: Pick<SnapshotStore, 'deleteMany'>;
  scoreField: Pick<StakesScoreField, 'set'>;
  connector: Pick<Connector, 'pushCustomers' | 'pushDeals' | 'deleteObjects'>;
  connections: Pick<ConnectionStore, 'get'>;
  seed: SeedStore<SeedRecord>;
  data: DemoData;
  siteUrl: string;
  clock: () => Date;
  // Each resolver call stops starting new work after this long, well inside the Forge
  // invocation limit, and the settings page calls again until the seed is done.
  budgetMs?: number;
}

export const DEFAULT_BUDGET_MS = 15_000;
const PLACEHOLDER_SUMMARY = 'Stakes demo placeholder (deleted automatically)';

const STEP_LABELS: Record<SeedStep, string> = {
  prepare: 'Checking the projects',
  version: 'Creating the fix version',
  issues: 'Creating issues',
  fillers: 'Tidying up placeholder issues',
  requests: 'Creating support requests',
  sprints: 'Creating sprints',
  crm: 'Loading customers and deals',
  history: 'Backfilling score history',
  done: 'Demo data loaded',
};

const REMOVE_LABELS: Record<RemoveStep, string> = {
  issues: 'Deleting demo issues and requests',
  extras: 'Deleting the demo version and sprints',
  connector: 'Removing customers and deals from the Teamwork Graph',
  storage: 'Clearing demo data from Stakes storage',
  done: 'Demo data removed',
};

const issueNumber = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1));

// ---------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------

// Each step has a fixed share of the bar. How many placeholders a project needs is only
// known once the first issue exists, so counting raw units would make the bar jump back.
const STEP_SHARE: Record<Exclude<SeedStep, 'done'>, number> = {
  prepare: 2,
  version: 2,
  issues: 30,
  fillers: 20,
  requests: 30,
  sprints: 4,
  crm: 6,
  history: 6,
};
const SEED_ORDER: SeedStep[] = [
  'prepare',
  'version',
  'issues',
  'fillers',
  'requests',
  'sprints',
  'crm',
  'history',
  'done',
];

function progress(record: SeedRecord, data: DemoData): { done: number; total: number } {
  const at = SEED_ORDER.indexOf(record.step);
  let done = 0;
  for (const step of SEED_ORDER.slice(0, at)) if (step !== 'done') done += STEP_SHARE[step];
  const within: Partial<Record<SeedStep, number>> = {
    issues: record.slots ? record.slotCursor / Math.max(1, record.slots.length) : 0,
    fillers: record.fillersDeleted / Math.max(1, record.fillerKeys.length),
    requests: record.requestsDone / Math.max(1, data.requests.length),
  };
  if (record.step !== 'done') done += STEP_SHARE[record.step] * (within[record.step] ?? 0);
  return { done: Math.round(done), total: 100 };
}

function countsOf(record: SeedRecord, data: DemoData): SeedStatus['counts'] {
  const after = (s: SeedStep) => SEED_ORDER.indexOf(record.step) > SEED_ORDER.indexOf(s);
  return {
    issues: record.createdKeys.length,
    requests: Object.keys(record.requestKeys).length,
    customers: after('crm') ? data.customers.length : 0,
    deals: after('crm') ? data.deals.length : 0,
    messages: after('crm') ? data.messages.length : 0,
    history: after('history') ? data.issues.length * DEMO_HISTORY_DAYS : 0,
  };
}

function statusFor(
  record: SeedRecord,
  data: DemoData,
  now: Date,
  message: string | null = null,
): SeedStatus {
  const removing = record.removeStep !== null;
  const { done, total } = removing ? removeProgress(record) : progress(record, data);
  return {
    state: removing ? 'removing' : record.step === 'done' ? 'loaded' : 'loading',
    step: removing ? REMOVE_LABELS[record.removeStep!] : STEP_LABELS[record.step],
    done,
    total,
    counts: countsOf(record, data),
    softwareProjectKey: record.softwareProjectKey,
    serviceProjectKey: record.serviceProjectKey,
    // Only keys that differ from the story are worth showing to the admin.
    keyMap: Object.fromEntries(
      Object.entries(record.keyMap).filter(([story, real]) => story !== real),
    ),
    message,
    updatedAt: now.toISOString(),
  };
}

function removeProgress(record: SeedRecord): { done: number; total: number } {
  const order: RemoveStep[] = ['issues', 'extras', 'connector', 'storage', 'done'];
  return { done: order.indexOf(record.removeStep ?? 'issues'), total: order.length - 1 };
}

// ---------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------

function newRecord(
  input: { softwareProjectKey: string; serviceProjectKey: string; accountId: string },
  now: Date,
): SeedRecord {
  return {
    ...input,
    seededAt: now.toISOString(),
    step: 'prepare',
    plan: null,
    versionId: null,
    sprintIds: {},
    slots: null,
    slotCursor: 0,
    keyMap: {},
    createdKeys: [],
    fillerKeys: [],
    fillersDeleted: 0,
    requestKeys: {},
    requestsDone: 0,
    connector: { connectionId: null, customerIds: [], dealIds: [] },
    removeStep: null,
    pendingDeletes: null,
    removed: { issues: 0, customers: 0, deals: 0, history: 0 },
  };
}

class SeedProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedProblem';
  }
}

async function prepare(deps: SeedDeps, r: SeedRecord): Promise<void> {
  if (r.softwareProjectKey === r.serviceProjectKey) {
    throw new SeedProblem(
      'Pick two different projects: one software project and one service project.',
    );
  }
  const [software, service] = await Promise.all([
    deps.writer.project(r.softwareProjectKey),
    deps.writer.project(r.serviceProjectKey),
  ]);
  if (!software || software.type !== 'software') {
    throw new SeedProblem(`${r.softwareProjectKey} is not a software project you can see.`);
  }
  if (!service || service.type !== 'service_desk') {
    throw new SeedProblem(`${r.serviceProjectKey} is not a service project you can see.`);
  }
  const typeId = (name: DemoIssue['type']) => {
    const exact = software.issueTypes.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const fallback = software.issueTypes.find((t) => !/epic|sub-?task/i.test(t.name));
    const found = exact ?? fallback;
    if (!found)
      throw new SeedProblem(`${r.softwareProjectKey} has no issue type Stakes can create.`);
    return found.id;
  };
  const [desk, pointsFieldId, boardId] = await Promise.all([
    deps.writer.serviceDesk(r.serviceProjectKey),
    deps.writer.storyPointFieldId(r.softwareProjectKey, typeId('Story')),
    deps.writer.scrumBoard(r.softwareProjectKey),
  ]);
  if (!desk || desk.requestTypes.length === 0) {
    throw new SeedProblem(
      `${r.serviceProjectKey} has no request types to create demo requests with.`,
    );
  }
  const preferred = desk.requestTypes.find((t) =>
    /get (it )?help|report.*problem|general/i.test(t.name),
  );
  r.plan = {
    projectId: software.id,
    issueTypeIds: { Bug: typeId('Bug'), Story: typeId('Story'), Task: typeId('Task') },
    pointsFieldId,
    serviceDeskId: desk.id,
    requestTypeId: (preferred ?? desk.requestTypes[0]!).id,
    boardId,
  };
}

function issuePayload(deps: SeedDeps, r: SeedRecord, storyKey: string | null): NewIssue {
  const plan = r.plan!;
  const label = deps.data.project.label;
  if (storyKey === null) {
    return {
      projectId: plan.projectId,
      issueTypeId: plan.issueTypeIds.Task,
      summary: PLACEHOLDER_SUMMARY,
      labels: [label],
    };
  }
  const issue = deps.data.issues.find((i) => i.key === storyKey)!;
  return {
    projectId: plan.projectId,
    issueTypeId: plan.issueTypeIds[issue.type],
    summary: issue.summary,
    priority: issue.priority,
    labels: [label],
    storyPoints: plan.pointsFieldId
      ? { fieldId: plan.pointsFieldId, value: issue.storyPoints }
      : null,
    fixVersionIds: issue.fixVersion && r.versionId ? [r.versionId] : [],
  };
}

// Jira numbers issues itself and never reuses a number. To give the demo its story
// keys (PAY-118, PAY-142, PAY-150 and so on) on a fresh project, Stakes creates the
// issues in key order with placeholders in the gaps, then deletes the placeholders. If
// the project has already passed those numbers, the issues get the next free keys and
// the settings page shows which story key became which.
async function planSlots(deps: SeedDeps, r: SeedRecord): Promise<void> {
  const [probe] = await deps.writer.createIssues([issuePayload(deps, r, null)]);
  if (!probe) throw new SeedProblem(`Stakes could not create issues in ${r.softwareProjectKey}.`);
  r.fillerKeys.push(probe);
  const stories = deps.data.issues
    .map((i) => ({ key: i.key, n: issueNumber(i.key) }))
    .sort((a, b) => a.n - b.n);
  const next = issueNumber(probe) + 1;
  const first = stories[0]!.n;
  if (next <= first) {
    const byNumber = new Map(stories.map((s) => [s.n, s.key]));
    r.slots = [];
    for (let n = next; n <= stories[stories.length - 1]!.n; n++)
      r.slots.push({ storyKey: byNumber.get(n) ?? null });
  } else {
    r.slots = stories.map((s) => ({ storyKey: s.key }));
  }
}

async function createSlots(deps: SeedDeps, r: SeedRecord): Promise<void> {
  const chunk = r.slots!.slice(r.slotCursor, r.slotCursor + 50);
  const keys = await deps.writer.createIssues(chunk.map((s) => issuePayload(deps, r, s.storyKey)));
  for (let i = 0; i < chunk.length; i++) {
    let key = keys[i] ?? null;
    const storyKey = chunk[i]!.storyKey;
    if (!key && storyKey) {
      // Usually a story-points or priority field missing from the create screen; the
      // issue still matters more than those fields, so retry without them.
      const plain = { ...issuePayload(deps, r, storyKey), storyPoints: null, priority: undefined };
      key = (await deps.writer.createIssues([plain]))[0] ?? null;
    }
    if (!key) {
      if (storyKey) throw new SeedProblem(`Jira refused to create the demo issue ${storyKey}.`);
      continue;
    }
    if (storyKey) {
      r.keyMap[storyKey] = key;
      r.createdKeys.push(key);
    } else r.fillerKeys.push(key);
  }
  r.slotCursor += chunk.length;
}

async function createRequest(deps: SeedDeps, r: SeedRecord, index: number): Promise<void> {
  const request = deps.data.requests[index]!;
  const label = deps.data.project.label;
  let key = r.requestKeys[request.key];
  if (!key) {
    key = await deps.writer.createRequest({
      serviceDeskId: r.plan!.serviceDeskId,
      requestTypeId: r.plan!.requestTypeId,
      summary: request.summary,
      description: `Demo request from the fictional Orbit Pay dataset, loaded by Stakes.`,
    });
    r.requestKeys[request.key] = key;
    r.keyMap[request.key] = key;
    await deps.seed.saveRecord(r);
  }
  const labels = request.escalated ? [label, 'escalation'] : [label];
  try {
    await deps.writer.updateIssue(key, { priority: request.priority, addLabels: labels });
  } catch (e) {
    if (needsConsent(e)) throw e;
    // A service project on a different priority scheme refuses the name; the request
    // keeps its default priority rather than failing the whole seed.
    console.warn('demo request priority not set', { request: request.key });
    await deps.writer.updateIssue(key, { addLabels: labels });
  }
  await deps.writer.setProperty(key, DEMO_REQUEST_PROPERTY, {
    createdAt: demoRequestCreatedAt(request, new Date(r.seededAt)),
    slaBreachAt: null,
  });
  const linked = r.keyMap[request.linkedIssue];
  if (linked) await deps.writer.linkIssues(key, linked);
}

async function createSprints(deps: SeedDeps, r: SeedRecord): Promise<void> {
  if (r.plan!.boardId === null) {
    console.warn('demo sprints skipped: no scrum board', { project: r.softwareProjectKey });
    return;
  }
  const offset = demoOffsetDays(deps.data, new Date(r.seededAt));
  for (const sprint of deps.data.project.sprints) {
    if (r.sprintIds[sprint.id] !== undefined) continue;
    const at = (d: string) => `${shiftDate(d, offset)}T09:00:00.000Z`;
    r.sprintIds[sprint.id] = await deps.writer.createSprint(
      r.plan!.boardId,
      sprint.name,
      at(sprint.startDate),
      at(sprint.endDate),
      sprint.id === 'active',
    );
    await deps.seed.saveRecord(r);
    const keys = deps.data.issues
      .filter((i) => i.sprint === sprint.id)
      .map((i) => r.keyMap[i.key])
      .filter((k): k is string => Boolean(k));
    if (keys.length > 0) await deps.writer.moveToSprint(r.sprintIds[sprint.id]!, keys);
  }
}

async function loadCrm(deps: SeedDeps, r: SeedRecord): Promise<void> {
  const seededAt = new Date(r.seededAt);
  const keyFor = (k: string) => r.keyMap[k] ?? k;
  const rows = demoMirrorRows(deps.data, {
    seededAt,
    ownerAccountId: r.accountId,
    keyFor,
    siteUrl: deps.siteUrl,
  });
  await deps.mirror.upsertCustomers(rows.customers);
  await deps.mirror.upsertDeals(rows.deals);
  await deps.mirror.linkCustomers(rows.customerLinks);
  await deps.mirror.upsertMessages(rows.messages);

  const connectionId = await deps.connections.get();
  if (connectionId) {
    const issuesByCustomer = new Map<string, string[]>();
    for (const d of rows.deals)
      issuesByCustomer.set(d.customerId, [
        ...(issuesByCustomer.get(d.customerId) ?? []),
        ...d.issueKeys,
      ]);
    const names = new Map(rows.customers.map((c) => [c.id, c.name]));
    await deps.connector.pushCustomers(
      rows.customers.map((c) => ({
        ...c,
        issueKeys: [...new Set(issuesByCustomer.get(c.id) ?? [])],
      })),
      connectionId,
      deps.siteUrl,
    );
    await deps.connector.pushDeals(
      rows.deals.map((d) => ({
        id: d.id,
        name: d.name,
        customerName: names.get(d.customerId) ?? d.customerId,
        amountUsd: d.amountUsd,
        stage: d.stage,
        closeDate: d.closeDate,
        isClosed: d.closed,
        issueKeys: d.issueKeys,
      })),
      connectionId,
      deps.siteUrl,
    );
    r.connector = {
      connectionId,
      customerIds: rows.customers.map((c) => c.id),
      dealIds: rows.deals.map((d) => d.id),
    };
  }
  await deps.mirror.bumpDealsVersion();
}

// What each demo issue scores on the day it is seeded, with the seeded percentiles and
// without the hand-linked goal: the flat history line every issue without its own
// story starts from.
export function seededScore(data: DemoData, storyKey: string, seededAt: Date): number {
  const evidence = demoEvidence(data, storyKey, { seededAt, now: seededAt, withGoals: false });
  return score(
    normalise(
      rawSignals(evidence, seededAt),
      data.project.percentiles,
      data.project.percentiles.scoredCount,
    ),
    DEFAULT_WEIGHTS,
  ).score;
}

async function backfill(deps: SeedDeps, r: SeedRecord): Promise<void> {
  const seededAt = new Date(r.seededAt);
  const { percentiles } = deps.data.project;
  await deps.percentiles.save(r.softwareProjectKey, {
    R: percentiles.R,
    S: percentiles.S,
    C: percentiles.C,
    H: percentiles.H,
    scoredCount: percentiles.scoredCount,
    at: seededAt.toISOString(),
    seeded: true,
  });
  const points = deps.data.issues.flatMap((issue) => {
    const key = r.keyMap[issue.key];
    if (!key) return [];
    const flat = seededScore(deps.data, issue.key, seededAt);
    const series = issue.history ?? Array.from({ length: DEMO_HISTORY_DAYS }, () => flat);
    return series.map((value, i) => ({
      issueKey: key,
      projectKey: r.softwareProjectKey,
      day: isoDay(addDays(seededAt, i - series.length)),
      score: value,
      badges: [],
      source: 'demo' as const,
    }));
  });
  await deps.history.recordMany(points);
  const latestScores = new Map<string, number>();
  for (const point of points) latestScores.set(point.issueKey, point.score);
  // The field only mirrors scores for JQL and is rewritten when an issue is next scored,
  // so a refused write must not leave the demo half loaded.
  let refused = 0;
  await Promise.all(
    [...latestScores].map(async ([issueKey, score]) => {
      try {
        await deps.scoreField.set(issueKey, score);
      } catch (e) {
        if (needsConsent(e)) throw e;
        refused++;
      }
    }),
  );
  if (refused > 0) console.warn('demo score field not set', { refused });
}

async function runSeedStep(deps: SeedDeps, r: SeedRecord): Promise<void> {
  switch (r.step) {
    case 'prepare':
      await prepare(deps, r);
      r.step = 'version';
      return;
    case 'version': {
      const offset = demoOffsetDays(deps.data, new Date(r.seededAt));
      const { name, releaseDate } = deps.data.project.version;
      r.versionId ??= await deps.writer.createVersion(
        r.plan!.projectId,
        name,
        shiftDate(releaseDate, offset)!,
      );
      r.step = 'issues';
      return;
    }
    case 'issues':
      if (r.slots === null) await planSlots(deps, r);
      else await createSlots(deps, r);
      if (r.slots !== null && r.slotCursor >= r.slots.length) r.step = 'fillers';
      return;
    case 'fillers': {
      const key = r.fillerKeys[r.fillersDeleted];
      if (key) {
        await deps.writer.deleteIssue(key);
        r.fillersDeleted++;
      }
      if (r.fillersDeleted >= r.fillerKeys.length) r.step = 'requests';
      return;
    }
    case 'requests':
      if (r.requestsDone < deps.data.requests.length) {
        await createRequest(deps, r, r.requestsDone);
        r.requestsDone++;
      }
      if (r.requestsDone >= deps.data.requests.length) r.step = 'sprints';
      return;
    case 'sprints':
      await createSprints(deps, r);
      r.step = 'crm';
      return;
    case 'crm':
      await loadCrm(deps, r);
      r.step = 'history';
      return;
    case 'history':
      await backfill(deps, r);
      r.step = 'done';
      return;
    case 'done':
      return;
  }
}

async function runWithinBudget(
  deps: SeedDeps,
  r: SeedRecord,
  step: (r: SeedRecord) => Promise<void>,
  finished: (r: SeedRecord) => boolean,
): Promise<Result<SeedStatus>> {
  const started = deps.clock().getTime();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  try {
    // Every call does at least one unit of work, so polling always moves forward even
    // when a single unit takes longer than the budget.
    do {
      if (finished(r)) break;
      await step(r);
      // Saved after every unit of work, so a call cut off by the platform resumes from
      // the last thing that finished rather than repeating it.
      await deps.seed.saveRecord(r);
    } while (deps.clock().getTime() - started < budget);
  } catch (e) {
    if (needsConsent(e)) throw e;
    const problem =
      e instanceof SeedProblem
        ? e.message
        : 'Stakes hit a problem talking to Jira. Try again to resume.';
    console.warn('demo seed step failed', {
      step: r.removeStep ?? r.step,
      error: e instanceof Error ? e.name : 'unknown',
      ...(e instanceof JiraError ? { operation: e.operation, status: e.status } : {}),
    });
    const status = { ...statusFor(r, deps.data, deps.clock(), problem), state: 'failed' as const };
    await deps.seed.saveRecord(r);
    await deps.seed.saveStatus(status);
    return err(e instanceof SeedProblem ? 'INVALID_INPUT' : 'UPSTREAM_DEGRADED', problem);
  }
  const status = statusFor(r, deps.data, deps.clock());
  await deps.seed.saveStatus(status);
  return ok(status);
}

// Starts a load, or resumes one that is in progress or failed part-way. Each call does
// as much as fits in the time budget and returns the status for the progress bar.
export async function seedDemo(
  deps: SeedDeps,
  input: { softwareProjectKey: string; serviceProjectKey: string; accountId: string },
): Promise<Result<SeedStatus>> {
  const status = await deps.seed.status();
  if (status.state === 'loaded') return ok(status);
  if (status.state === 'removing')
    return err('INVALID_INPUT', 'Demo data is being removed. Finish removing it first.');
  const existing = await deps.seed.record();
  const record =
    existing && existing.removeStep === null && existing.step !== 'done'
      ? existing
      : newRecord(input, deps.clock());
  if (record.step === 'prepare') await deps.seed.saveRecord(record);
  return runWithinBudget(
    deps,
    record,
    (r) => runSeedStep(deps, r),
    (r) => r.step === 'done',
  );
}

// ---------------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------------

async function runRemoveStep(deps: SeedDeps, r: SeedRecord): Promise<void> {
  switch (r.removeStep) {
    case 'issues': {
      // The recorded keys, plus anything carrying the demo label that a failed run did
      // not get to record, limited to the two demo projects. Worked out once, then
      // drained across as many calls as it takes.
      if (r.pendingDeletes === null) {
        const label = deps.data.project.label;
        const labelled = await deps.writer
          .searchKeys(
            `project in (${r.softwareProjectKey}, ${r.serviceProjectKey}) AND labels = "${label}"`,
          )
          .catch(() => [] as string[]);
        const recorded = [
          ...r.createdKeys,
          ...Object.values(r.requestKeys),
          ...r.fillerKeys.slice(r.fillersDeleted),
        ];
        r.pendingDeletes = [...new Set([...recorded, ...labelled])];
        return;
      }
      const key = r.pendingDeletes[0];
      if (key) {
        if ((await deps.writer.deleteIssue(key)) === 'deleted') r.removed.issues++;
        r.pendingDeletes = r.pendingDeletes.slice(1);
      }
      if (r.pendingDeletes.length === 0) r.removeStep = 'extras';
      return;
    }
    case 'extras':
      for (const id of Object.values(r.sprintIds))
        if (id !== undefined) await deps.writer.deleteSprint(id);
      r.sprintIds = {};
      if (r.versionId) await deps.writer.deleteVersion(r.versionId);
      r.versionId = null;
      r.removeStep = 'connector';
      return;
    case 'connector': {
      const connectionId = r.connector.connectionId ?? (await deps.connections.get());
      if (connectionId && (r.connector.customerIds.length > 0 || r.connector.dealIds.length > 0)) {
        await deps.connector.deleteObjects(DEAL_TYPE, r.connector.dealIds, connectionId);
        await deps.connector.deleteObjects(
          CUSTOMER_ORG_TYPE,
          r.connector.customerIds,
          connectionId,
        );
      }
      r.connector = { connectionId: null, customerIds: [], dealIds: [] };
      r.removeStep = 'storage';
      return;
    }
    case 'storage': {
      const counts = await deps.mirror.deleteBySource('demo');
      r.removed.customers = counts.customers;
      r.removed.deals = counts.deals;
      r.removed.history = await deps.history.deleteDemo();
      await deps.snapshots.deleteMany(Object.values(r.keyMap));
      const stored = await deps.percentiles.get(r.softwareProjectKey);
      if (stored?.seeded) await deps.percentiles.delete(r.softwareProjectKey);
      await deps.mirror.bumpDealsVersion();
      r.removeStep = 'done';
      return;
    }
    default:
      return;
  }
}

export async function removeDemo(
  deps: SeedDeps,
): Promise<Result<SeedStatus & { removed: SeedRecord['removed'] }>> {
  const record = await deps.seed.record();
  if (!record)
    return ok({ ...EMPTY_SEED_STATUS, removed: { issues: 0, customers: 0, deals: 0, history: 0 } });
  record.removeStep ??= 'issues';
  const result = await runWithinBudget(
    deps,
    record,
    (r) => runRemoveStep(deps, r),
    (r) => r.removeStep === 'done',
  );
  if (!result.ok) return result;
  if (record.removeStep !== 'done') return ok({ ...result.data, removed: record.removed });
  await deps.seed.clear();
  console.log('demo data removed', record.removed);
  return ok({
    ...EMPTY_SEED_STATUS,
    updatedAt: deps.clock().toISOString(),
    removed: record.removed,
  });
}
