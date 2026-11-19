import { describe, expect, it, vi } from 'vitest';
import type { ProjectKey } from '@stakes/contracts';
import {
  applySprintPlan,
  planSprint,
  sprintOptions,
  type PlanSprintDeps,
} from '../../src/services/planSprint.js';
import { JiraError } from '../../src/adapters/jira.js';
import type { AgileSprint } from '../../src/adapters/sprint.js';
import { issueDetails, NOW } from '../fakes/deps.js';
import { snapshot } from '../fakes/snapshot.js';

vi.spyOn(console, 'log').mockImplementation(() => {});

const future: AgileSprint[] = [
  { id: 11, name: 'PAY Sprint 24', state: 'future', completeDate: null },
];

function planningDeps(): PlanSprintDeps {
  const pinned = issueDetails({ key: 'PAY-1', summary: 'Pinned', storyPoints: 2 });
  const candidates = [
    issueDetails({ key: 'PAY-2', summary: 'Medium', storyPoints: 4 }),
    issueDetails({ key: 'PAY-3', summary: 'Best fit', storyPoints: 8 }),
    issueDetails({ key: 'PAY-4', summary: 'No estimate', storyPoints: null }),
  ];
  const snapshots = [
    snapshot({ issueKey: 'PAY-1', score: 50, raw: { R: 1000, S: 0, C: 0, H: 0, G: 0, U: 0 } }),
    snapshot({ issueKey: 'PAY-2', score: 90, raw: { R: 2000, S: 0, C: 0, H: 0, G: 0, U: 0 } }),
    snapshot({ issueKey: 'PAY-3', score: 95, raw: { R: 3000, S: 0, C: 0, H: 0, G: 0, U: 0 } }),
    snapshot({ issueKey: 'PAY-4', score: 100, raw: { R: 4000, S: 0, C: 0, H: 0, G: 0, U: 0 } }),
  ];
  return {
    sprints: {
      boards: vi.fn(async () => [
        { id: 7, name: 'PAY board', futureSprints: [{ id: 11, name: 'PAY Sprint 24' }] },
      ]),
      boardProjects: vi.fn(async () => ['PAY'] as ProjectKey[]),
      sprints: vi.fn(async (_boardId, state) =>
        state === 'future'
          ? future
          : [
              { id: 10, name: 'Sprint 23', state: 'closed' as const, completeDate: '2026-11-01' },
              { id: 9, name: 'Sprint 22', state: 'closed' as const, completeDate: '2026-10-01' },
              { id: 8, name: 'Sprint 21', state: 'closed' as const, completeDate: '2026-09-01' },
            ],
      ),
      sprintIssues: vi.fn(async () => [pinned]),
      unassignedIssues: vi.fn(async () => candidates),
      completedPoints: vi.fn(async () => [10, 8, 12]),
    },
    snapshots: { latestMany: vi.fn(async () => snapshots) },
  };
}

describe('sprintOptions', () => {
  it('lists boards and future sprints for the project', async () => {
    const deps = planningDeps();
    expect(await sprintOptions(deps, 'PAY')).toEqual({
      boards: [{ id: 7, name: 'PAY board', futureSprints: [{ id: 11, name: 'PAY Sprint 24' }] }],
    });
  });
});

describe('planSprint', () => {
  it('keeps pinned issues, optimises open unassigned issues and reports totals', async () => {
    const deps = planningDeps();
    const plan = await planSprint(deps, { boardId: 7, sprintId: 11 });
    expect(plan).toMatchObject({
      boardId: 7,
      sprintId: 11,
      sprintName: 'PAY Sprint 24',
      capacity: 10,
      defaultCapacity: 10,
      pointsUsed: 10,
      scoreCovered: 145,
      revenueUsd: 4000,
      needsEstimate: ['PAY-4'],
    });
    expect(plan?.issues).toEqual([
      expect.objectContaining({ issueKey: 'PAY-1', pinned: true, points: 2 }),
      expect.objectContaining({ issueKey: 'PAY-3', pinned: false, points: 8 }),
    ]);
    expect(deps.sprints.unassignedIssues).toHaveBeenCalledWith(['PAY']);
  });

  it('uses an explicit capacity and returns null for an unknown future sprint', async () => {
    const deps = planningDeps();
    const plan = await planSprint(deps, { boardId: 7, sprintId: 11, capacity: 6 });
    expect(plan?.issues.map((issue) => issue.issueKey)).toEqual(['PAY-1', 'PAY-2']);
    expect(plan?.pointsUsed).toBe(6);
    expect(await planSprint(deps, { boardId: 7, sprintId: 999 })).toBeNull();
  });
});

describe('applySprintPlan', () => {
  it('moves each issue and writes its audit row', async () => {
    const deps = {
      sprints: { moveIssues: vi.fn(async () => {}) },
      snapshots: { latest: vi.fn(async () => snapshot({ score: 89 })) },
      audit: { record: vi.fn(async () => {}) },
      clock: () => NOW,
    };
    expect(await applySprintPlan(deps, 11, ['PAY-1', 'PAY-2'], 'actor-1')).toEqual({
      applied: ['PAY-1', 'PAY-2'],
      failed: [],
    });
    expect(deps.sprints.moveIssues).toHaveBeenNthCalledWith(1, 11, ['PAY-1']);
    expect(deps.sprints.moveIssues).toHaveBeenNthCalledWith(2, 11, ['PAY-2']);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        issueKey: 'PAY-2',
        kind: 'sprint',
        from: null,
        to: '11',
        score: 89,
        actorAccountId: 'actor-1',
        at: NOW.toISOString(),
      }),
    );
  });

  it('continues after a failed move without auditing it', async () => {
    const deps = {
      sprints: {
        moveIssues: vi.fn(async (_sprint, keys: string[]) => {
          if (keys[0] === 'PAY-1') throw new JiraError('move', 403);
        }),
      },
      snapshots: { latest: vi.fn(async () => null) },
      audit: { record: vi.fn(async () => {}) },
      clock: () => NOW,
    };
    expect(await applySprintPlan(deps, 11, ['PAY-1', 'PAY-2'], 'actor-1')).toEqual({
      applied: ['PAY-2'],
      failed: [{ issueKey: 'PAY-1', code: 'FORBIDDEN' }],
    });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
  });
});
