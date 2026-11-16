import type {
  BacklogBatch,
  BacklogList,
  BacklogRow,
  BacklogSummary,
  IssueKey,
  ProjectKey,
  Snapshot,
} from '@stakes/contracts';
import { MIN_SCORED_FOR_PERCENTILES, type P95 } from '../core/normalise.js';
import { rawSignals } from '../core/signals.js';
import type { IssueDetails, JiraReader } from '../adapters/jira.js';
import type {
  MirrorStore,
  PercentileStore,
  SettingsStore,
  SnapshotStore,
  StoredPercentiles,
} from '../adapters/storage.js';
import { getStakes, isFresh, type GetStakesDeps } from './getStakes.js';

export interface BacklogDeps {
  jira: Pick<JiraReader, 'issue' | 'openIssues'>;
  snapshots: Pick<SnapshotStore, 'latestMany'>;
  settings: Pick<SettingsStore, 'get'>;
  mirror: Pick<MirrorStore, 'dealsVersion'>;
  percentiles: Pick<PercentileStore, 'get' | 'save'>;
  stakes: GetStakesDeps;
  clock: () => Date;
}

export function rankBacklog(rows: BacklogRow[]): BacklogRow[] {
  return rows.sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }),
  );
}

export function toBacklogRow(issue: IssueDetails, snapshot: Snapshot | null): BacklogRow {
  const evidence = snapshot?.evidence ?? [];
  const customers = new Set(
    evidence.flatMap((e) => (e.facts.kind === 'customer' ? [e.facts.customerId] : [])),
  );
  const tickets = new Set(
    evidence.flatMap((e) => (e.facts.kind === 'request' ? [e.facts.requestKey] : [])),
  );
  return {
    issueKey: issue.key,
    summary: issue.summary,
    status: issue.status,
    assignee: issue.assigneeAccountId,
    score: snapshot?.score ?? null,
    currentPriority: issue.priority,
    suggestedPriority: snapshot?.suggestedPriority ?? null,
    revenueUsd: snapshot?.raw.R ?? 0,
    customers: customers.size,
    tickets: tickets.size,
    badges: snapshot?.badges ?? [],
    trend: snapshot?.badges.includes('stakes-jump') ? 'up' : 'flat',
    storyPoints: issue.storyPoints,
    fixVersions: issue.fixVersions,
    components: issue.components,
  };
}

function summarize(rows: BacklogRow[], snapshots: Snapshot[], now: Date): BacklogSummary {
  return {
    total: rows.length,
    scored: rows.filter((row) => row.score !== null).length,
    silentFires: rows.filter((row) => row.badges.includes('silent-fire')).length,
    phantoms: rows.filter((row) => row.badges.includes('phantom')).length,
    revenueUsd: rawSignals(
      snapshots.flatMap((snapshot) => snapshot.evidence),
      now,
    ).R,
  };
}

export async function listBacklog(deps: BacklogDeps, projectKey: ProjectKey): Promise<BacklogList> {
  const issues = await deps.jira.openIssues(projectKey);
  const [snapshots, settings, dealsVersion] = await Promise.all([
    deps.snapshots.latestMany(issues.map((issue) => issue.key)),
    deps.settings.get(),
    deps.mirror.dealsVersion(),
  ]);
  const byIssue = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot]));
  const now = deps.clock();
  const rows = rankBacklog(
    issues.map((issue) => toBacklogRow(issue, byIssue.get(issue.key) ?? null)),
  );
  const staleKeys = issues
    .filter((issue) => {
      const snapshot = byIssue.get(issue.key);
      return (
        !snapshot ||
        !isFresh(snapshot, now, {
          issueUpdated: issue.updated,
          dealsVersion,
          weightsVersion: settings.weightsVersion,
        })
      );
    })
    .map((issue) => issue.key);
  return { rows, staleKeys, summary: summarize(rows, snapshots, now) };
}

export async function recomputeBatch(
  deps: BacklogDeps,
  issueKeys: IssueKey[],
): Promise<BacklogBatch> {
  const rows = await Promise.all(
    issueKeys.map(async (issueKey) => {
      const [result, issue] = await Promise.all([
        getStakes(deps.stakes, issueKey, { refresh: true }),
        deps.jira.issue(issueKey),
      ]);
      return result.ok && issue ? toBacklogRow(issue, result.data) : null;
    }),
  );
  return { rows: rankBacklog(rows.filter((row): row is BacklogRow => row !== null)) };
}

const LOG_SIGNALS = ['R', 'S', 'C', 'H'] as const;

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

export async function updatePercentiles(
  deps: BacklogDeps,
  projectKey: ProjectKey,
): Promise<StoredPercentiles> {
  const [issues, existing] = await Promise.all([
    deps.jira.openIssues(projectKey),
    deps.percentiles.get(projectKey),
  ]);
  const snapshots = await deps.snapshots.latestMany(issues.map((issue) => issue.key));
  const byIssue = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot]));
  const scored = issues
    .filter((issue) => !issue.labels.includes('stakes-demo'))
    .map((issue) => byIssue.get(issue.key))
    .filter((snapshot): snapshot is Snapshot => snapshot !== undefined);

  if (scored.length < MIN_SCORED_FOR_PERCENTILES && existing?.seeded) return existing;

  const p95 = Object.fromEntries(
    LOG_SIGNALS.map((signal) => [
      signal,
      percentile95(scored.map((snapshot) => snapshot.raw[signal] ?? 0)),
    ]),
  ) as P95;
  const next: StoredPercentiles = {
    ...p95,
    scoredCount: scored.length,
    at: deps.clock().toISOString(),
    seeded: false,
  };
  await deps.percentiles.save(projectKey, next);
  return next;
}
