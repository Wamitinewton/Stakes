import {
  projectKeyOf,
  type IssueKey,
  type MacroRow,
  type MacroTable,
  type ProjectKey,
  type Snapshot,
} from '@stakes/contracts';
import type { IssueDetails, JiraReader } from '../adapters/jira.js';
import type { SnapshotStore } from '../adapters/storage.js';
import { getCustomerExposure, searchCustomers, type CustomerDeps } from './customers.js';
import { listBacklog, type BacklogDeps } from './rankBacklog.js';
import { releaseStakes, type ReleaseDeps } from './releaseStakes.js';

export interface MacroDeps {
  backlog: BacklogDeps;
  release: ReleaseDeps;
  customers: CustomerDeps;
  jira: Pick<JiraReader, 'issue'>;
  snapshots: Pick<SnapshotStore, 'latestMany'>;
  siteUrl: string;
}

export type MacroQuery =
  | { mode: 'project'; projectKey: ProjectKey }
  | { mode: 'version'; projectKey: ProjectKey; version: string }
  | { mode: 'customer'; query: string };

interface IssueRow {
  issueKey: IssueKey;
  summary: string;
  score: number | null;
  url: string;
}

const byScore = (a: { issueKey: IssueKey; score: number | null }, b: typeof a) =>
  (b.score ?? -1) - (a.score ?? -1) ||
  a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true });

export function jiraBacklogUrl(siteUrl: string, projectKey: ProjectKey): string {
  return `${siteUrl.replace(/\/$/, '')}/jira/software/projects/${projectKey}/backlog`;
}

function table(rows: MacroRow[], projectKey: ProjectKey, siteUrl: string): MacroTable {
  return { rows, backlogUrl: jiraBacklogUrl(siteUrl, projectKey) };
}

async function enrichRows(deps: MacroDeps, issues: IssueRow[]): Promise<MacroRow[]> {
  const top = [...issues].sort(byScore).slice(0, 10);
  const [snapshots, details] = await Promise.all([
    deps.snapshots.latestMany(top.map((issue) => issue.issueKey)),
    Promise.all(top.map((issue) => deps.jira.issue(issue.issueKey))),
  ]);
  const byIssue = new Map<string, Snapshot>(
    snapshots.map((snapshot) => [snapshot.issueKey, snapshot]),
  );
  return top.map((issue, index) => {
    const snapshot = byIssue.get(issue.issueKey);
    const issueDetails: IssueDetails | null = details[index] ?? null;
    return {
      issueKey: issue.issueKey,
      issueUrl: issue.url,
      summary: issue.summary,
      score: snapshot?.score ?? issue.score,
      priority: issueDetails?.priority ?? snapshot?.currentPriority ?? '',
      badges: snapshot?.badges ?? [],
      revenueUsd: snapshot?.raw.R ?? 0,
    };
  });
}

const titleCase = (value: string) =>
  value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

export async function macroTable(deps: MacroDeps, query: MacroQuery): Promise<MacroTable | null> {
  if (query.mode === 'project') {
    const backlog = await listBacklog(deps.backlog, query.projectKey);
    const rows = backlog.rows.slice(0, 10).map((row) => ({
      issueKey: row.issueKey,
      issueUrl: row.issueUrl,
      summary: row.summary,
      score: row.score,
      priority: row.currentPriority,
      badges: row.badges,
      revenueUsd: row.revenueUsd,
    }));
    return table(rows, query.projectKey, deps.siteUrl);
  }

  if (query.mode === 'version') {
    const versions = await deps.release.jira.unreleasedVersions(query.projectKey);
    const version = versions.find(
      (candidate) => candidate.id === query.version || candidate.name === query.version,
    );
    if (!version) return null;
    const release = await releaseStakes(deps.release, query.projectKey, version.id);
    if (!release) return null;
    const rows = await enrichRows(deps, release.issues);
    return table(rows, query.projectKey, deps.siteUrl);
  }

  let matches = (await searchCustomers(deps.customers, query.query)).customers;
  if (matches.length === 0 && titleCase(query.query) !== query.query) {
    matches = (await searchCustomers(deps.customers, titleCase(query.query))).customers;
  }
  const customer =
    matches.find(
      (candidate) =>
        candidate.id === query.query || candidate.name.toLowerCase() === query.query.toLowerCase(),
    ) ?? (matches.length === 1 ? matches[0] : undefined);
  if (!customer) return null;
  const exposure = await getCustomerExposure(deps.customers, customer.id);
  if (!exposure) return null;
  const rows = await enrichRows(
    deps,
    exposure.issues.map((issue) => ({
      issueKey: issue.key,
      summary: issue.summary,
      score: issue.score,
      url: issue.url,
    })),
  );
  return {
    rows,
    backlogUrl: rows[0] ? jiraBacklogUrl(deps.siteUrl, projectKeyOf(rows[0].issueKey)) : null,
  };
}
