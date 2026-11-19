import { randomUUID } from 'node:crypto';
import type {
  ApplySprintPlanResult,
  IssueKey,
  ProjectKey,
  SprintOptions,
  SprintPlan,
} from '@stakes/contracts';
import { defaultCapacity, planScope } from '../core/knapsack.js';
import { JiraError } from '../adapters/jira.js';
import type { SprintAdapter } from '../adapters/sprint.js';
import type { AuditStore, SnapshotStore } from '../adapters/storage.js';

export interface SprintOptionsDeps {
  sprints: Pick<SprintAdapter, 'boards'>;
}

export interface PlanSprintDeps extends SprintOptionsDeps {
  sprints: Pick<
    SprintAdapter,
    'boards' | 'boardProjects' | 'sprints' | 'sprintIssues' | 'unassignedIssues' | 'completedPoints'
  >;
  snapshots: Pick<SnapshotStore, 'latestMany'>;
}

export interface ApplySprintPlanDeps {
  sprints: Pick<SprintAdapter, 'moveIssues'>;
  snapshots: Pick<SnapshotStore, 'latest'>;
  audit: Pick<AuditStore, 'record'>;
  clock: () => Date;
}

export async function sprintOptions(
  deps: SprintOptionsDeps,
  projectKey: ProjectKey,
): Promise<SprintOptions> {
  return { boards: await deps.sprints.boards(projectKey) };
}

export async function planSprint(
  deps: PlanSprintDeps,
  input: { boardId: number; sprintId: number; capacity?: number },
): Promise<SprintPlan | null> {
  const future = await deps.sprints.sprints(input.boardId, 'future');
  const sprint = future.find((item) => item.id === input.sprintId);
  if (!sprint) return null;

  const [projectKeys, pinnedIssues, recentPoints] = await Promise.all([
    deps.sprints.boardProjects(input.boardId),
    deps.sprints.sprintIssues(input.sprintId),
    deps.sprints.completedPoints(input.boardId),
  ]);
  const candidateIssues = await deps.sprints.unassignedIssues(projectKeys);
  const pinnedKeys = pinnedIssues.map((issue) => issue.key);
  const issues = [...pinnedIssues, ...candidateIssues];
  const snapshots = await deps.snapshots.latestMany(issues.map((issue) => issue.key));
  const byIssue = new Map(issues.map((issue) => [issue.key, issue]));
  const bySnapshot = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot]));
  const defaultPoints = defaultCapacity(
    recentPoints.map((completedPoints) => ({ state: 'closed', completedPoints })),
  );
  const capacity = input.capacity ?? defaultPoints;
  const scope = planScope({
    candidates: issues.map((issue) => ({
      issueKey: issue.key,
      points: issue.storyPoints,
      score: bySnapshot.get(issue.key)?.score ?? 0,
    })),
    pinned: pinnedKeys,
    capacity: capacity ?? 0,
  });
  const chosen = scope.chosen.map((issueKey) => {
    const issue = byIssue.get(issueKey)!;
    const snapshot = bySnapshot.get(issueKey);
    return {
      issueKey,
      summary: issue.summary,
      score: snapshot?.score ?? 0,
      revenueUsd: snapshot?.raw.R ?? 0,
      points: issue.storyPoints,
      pinned: pinnedKeys.includes(issueKey),
    };
  });

  return {
    boardId: input.boardId,
    sprintId: input.sprintId,
    sprintName: sprint.name,
    capacity,
    defaultCapacity: defaultPoints,
    issues: chosen,
    pointsUsed: scope.pointsUsed,
    scoreCovered: scope.scoreCovered,
    revenueUsd: chosen.reduce((total, issue) => total + issue.revenueUsd, 0),
    needsEstimate: scope.needsEstimate,
  };
}

function failureCode(error: unknown): ApplySprintPlanResult['failed'][number]['code'] {
  if (error instanceof JiraError) {
    if (error.status === 403) return 'FORBIDDEN';
    if (error.status === 404) return 'NOT_FOUND';
  }
  return 'UPSTREAM_DEGRADED';
}

export async function applySprintPlan(
  deps: ApplySprintPlanDeps,
  sprintId: number,
  issueKeys: IssueKey[],
  actorAccountId: string,
): Promise<ApplySprintPlanResult> {
  const result: ApplySprintPlanResult = { applied: [], failed: [] };
  for (const issueKey of issueKeys) {
    try {
      const snapshot = await deps.snapshots.latest(issueKey);
      await deps.sprints.moveIssues(sprintId, [issueKey]);
      await deps.audit.record({
        id: randomUUID(),
        issueKey,
        kind: 'sprint',
        from: null,
        to: String(sprintId),
        score: snapshot?.score ?? null,
        topEvidence: [],
        actorAccountId,
        at: deps.clock().toISOString(),
      });
      result.applied.push(issueKey);
    } catch (error) {
      result.failed.push({ issueKey, code: failureCode(error) });
    }
  }
  console.log('sprint plan apply finished', {
    sprintId,
    applied: result.applied.length,
    failed: result.failed.length,
    actorAccountId,
  });
  return result;
}
