import { z } from 'zod';
import {
  IssueKey,
  ProjectKey,
  type ApplySprintPlanResult,
  type SprintOptions,
  type SprintPlan,
} from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import type { SprintAdapter } from '../adapters/sprint.js';
import type { AuditStore, SnapshotStore } from '../adapters/storage.js';
import {
  applySprintPlan,
  planSprint,
  sprintOptions,
  type ApplySprintPlanDeps,
  type PlanSprintDeps,
} from '../services/planSprint.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export interface SprintDeps extends PlanSprintDeps, ApplySprintPlanDeps {
  sprints: SprintAdapter;
  snapshots: Pick<SnapshotStore, 'latest' | 'latestMany'>;
  audit: Pick<AuditStore, 'record'>;
}

export type SprintDepsFactory = (ctx: CallContext) => { sprint: SprintDeps };

const OptionsInput = z.object({
  projectKey: z.string().trim().toUpperCase().pipe(ProjectKey),
});
const PlanInput = z.object({
  boardId: z.number().int().positive(),
  sprintId: z.number().int().positive(),
  capacity: z.number().min(0).max(1000).optional(),
});
const ApplyInput = z.object({
  sprintId: z.number().int().positive(),
  issueKeys: z.array(z.string().trim().toUpperCase().pipe(IssueKey)).min(1).max(100),
  confirmed: z.literal(true).optional(),
});

export function sprintOptionsHandler(makeDeps: SprintDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<SprintOptions>> =>
    guarded('sprintOptions', async () => {
      const parsed = parseInput(OptionsInput, payload);
      if (!parsed.ok) return parsed;
      return ok(await sprintOptions(makeDeps(readContext(context)).sprint, parsed.data.projectKey));
    });
}

export function planSprintHandler(makeDeps: SprintDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<SprintPlan>> =>
    guarded('planSprint', async () => {
      const parsed = parseInput(PlanInput, payload);
      if (!parsed.ok) return parsed;
      const plan = await planSprint(makeDeps(readContext(context)).sprint, parsed.data);
      return plan ? ok(plan) : err('NOT_FOUND', 'Choose a future sprint from the selected board');
    });
}

export function applySprintPlanHandler(makeDeps: SprintDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<ApplySprintPlanResult>> =>
    guarded('applySprintPlan', async () => {
      const parsed = parseInput(ApplyInput, payload);
      if (!parsed.ok) return parsed;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm the sprint plan before moving issues');
      }
      const ctx = readContext(context);
      return ok(
        await applySprintPlan(
          makeDeps(ctx).sprint,
          parsed.data.sprintId,
          parsed.data.issueKeys,
          ctx.accountId,
        ),
      );
    });
}
