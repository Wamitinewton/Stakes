import { describe, expect, it, vi } from 'vitest';
import {
  applySprintPlanHandler,
  planSprintHandler,
  sprintOptionsHandler,
  type SprintDeps,
} from '../../src/resolvers/sprint.js';
import { NOW } from '../fakes/deps.js';

vi.mock('@forge/api', () => ({ default: { asUser: vi.fn() }, route: vi.fn() }));
vi.spyOn(console, 'log').mockImplementation(() => {});

const ctx = { accountId: 'actor-1', cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net' };

function deps(): SprintDeps {
  return {
    sprints: {
      boards: vi.fn(async () => [
        { id: 7, name: 'PAY board', futureSprints: [{ id: 11, name: 'Sprint 24' }] },
      ]),
      boardProjects: vi.fn(async () => []),
      sprints: vi.fn(async () => [
        { id: 11, name: 'Sprint 24', state: 'future' as const, completeDate: null },
      ]),
      sprintIssues: vi.fn(async () => []),
      unassignedIssues: vi.fn(async () => []),
      completedPoints: vi.fn(async () => []),
      moveIssues: vi.fn(async () => {}),
    },
    snapshots: { latest: vi.fn(async () => null), latestMany: vi.fn(async () => []) },
    audit: { record: vi.fn(async () => {}) },
    clock: () => NOW,
  };
}

describe('sprint resolvers', () => {
  it('returns board options and an empty plan', async () => {
    const all = deps();
    const factory = () => ({ sprint: all });
    expect(await sprintOptionsHandler(factory)({ projectKey: 'pay' }, ctx)).toMatchObject({
      ok: true,
      data: { boards: [{ id: 7 }] },
    });
    expect(
      await planSprintHandler(factory)({ boardId: 7, sprintId: 11, capacity: 10 }, ctx),
    ).toMatchObject({ ok: true, data: { sprintName: 'Sprint 24', capacity: 10, issues: [] } });
  });

  it('returns NOT_FOUND when the sprint is not in the future', async () => {
    const all = deps();
    const result = await planSprintHandler(() => ({ sprint: all }))(
      { boardId: 7, sprintId: 999 },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('does not move or audit anything without confirmation', async () => {
    const all = deps();
    const result = await applySprintPlanHandler(() => ({ sprint: all }))(
      { sprintId: 11, issueKeys: ['PAY-1'] },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(all.sprints.moveIssues).not.toHaveBeenCalled();
    expect(all.audit.record).not.toHaveBeenCalled();
  });

  it('moves confirmed issues as the caller and audits each move', async () => {
    const all = deps();
    const result = await applySprintPlanHandler(() => ({ sprint: all }))(
      { sprintId: 11, issueKeys: ['pay-1'], confirmed: true },
      ctx,
    );
    expect(result).toMatchObject({ ok: true, data: { applied: ['PAY-1'], failed: [] } });
    expect(all.sprints.moveIssues).toHaveBeenCalledWith(11, ['PAY-1']);
    expect(all.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'PAY-1', actorAccountId: 'actor-1' }),
    );
  });
});
