import { z } from 'zod';
import { IssueKey, ProjectKey, type BacklogBatch, type BacklogList } from '@stakes/contracts';
import { ok, type Result } from '../core/result.js';
import type { StoredPercentiles } from '../adapters/storage.js';
import {
  listBacklog,
  recomputeBatch,
  updatePercentiles,
  type BacklogDeps,
} from '../services/rankBacklog.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export type BacklogDepsFactory = (ctx: CallContext) => { backlog: BacklogDeps };

const ProjectInput = z.object({ projectKey: z.string().trim().toUpperCase().pipe(ProjectKey) });
const BatchInput = z.object({
  issueKeys: z.array(z.string().trim().toUpperCase().pipe(IssueKey)).min(1).max(20),
});

export function listBacklogHandler(makeDeps: BacklogDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<BacklogList>> =>
    guarded('listBacklog', async () => {
      const parsed = parseInput(ProjectInput, payload);
      if (!parsed.ok) return parsed;
      return ok(await listBacklog(makeDeps(readContext(context)).backlog, parsed.data.projectKey));
    });
}

export function recomputeBatchHandler(makeDeps: BacklogDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<BacklogBatch>> =>
    guarded('recomputeBatch', async () => {
      const parsed = parseInput(BatchInput, payload);
      if (!parsed.ok) return parsed;
      return ok(
        await recomputeBatch(makeDeps(readContext(context)).backlog, parsed.data.issueKeys),
      );
    });
}

export function updatePercentilesHandler(makeDeps: BacklogDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<StoredPercentiles>> =>
    guarded('updatePercentiles', async () => {
      const parsed = parseInput(ProjectInput, payload);
      if (!parsed.ok) return parsed;
      return ok(
        await updatePercentiles(makeDeps(readContext(context)).backlog, parsed.data.projectKey),
      );
    });
}
