import type { IssueKey, ProjectKey, ScoreHistory } from '@stakes/contracts';
import { addDays, isoDay } from '../core/dates';
import type { JiraReader } from '../adapters/jira';
import type { HistoryStore } from '../adapters/storage';

export interface GetHistoryDeps {
  history: Pick<HistoryStore, 'since'>;
  clock: () => Date;
}

export async function getHistory(
  deps: GetHistoryDeps,
  input: { issueKey: IssueKey; days: number },
): Promise<ScoreHistory> {
  const firstDay = isoDay(addDays(deps.clock(), -(input.days - 1)));
  const rows = await deps.history.since(input.issueKey, firstDay);
  return {
    points: rows.map((row) => ({ date: row.day, score: row.score })),
    jump: rows.at(-1)?.badges.includes('stakes-jump') ?? false,
  };
}

export interface IssueTrend {
  issueKey: IssueKey;
  first: number;
  last: number;
  change: number;
  jump: boolean;
}

// Movement across a project, limited to issues the caller can see: history rows are
// read by project, then kept only for open issues Jira lists for this user.
export async function getProjectTrend(
  deps: {
    history: Pick<HistoryStore, 'projectSince'>;
    jira: Pick<JiraReader, 'openIssues'>;
    clock: () => Date;
  },
  input: { projectKey: ProjectKey; days: number },
): Promise<IssueTrend[]> {
  const firstDay = isoDay(addDays(deps.clock(), -(input.days - 1)));
  const [rows, issues] = await Promise.all([
    deps.history.projectSince(input.projectKey, firstDay),
    deps.jira.openIssues(input.projectKey),
  ]);
  const visible = new Set(issues.map((i) => i.key));
  const byIssue = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!visible.has(row.issueKey)) continue;
    byIssue.set(row.issueKey, [...(byIssue.get(row.issueKey) ?? []), row]);
  }
  return [...byIssue.entries()]
    .map(([issueKey, points]) => {
      const first = points[0]!.score;
      const last = points.at(-1)!.score;
      return {
        issueKey,
        first,
        last,
        change: last - first,
        jump: points.at(-1)!.badges.includes('stakes-jump'),
      };
    })
    .sort((a, b) => Number(b.jump) - Number(a.jump) || b.change - a.change);
}
