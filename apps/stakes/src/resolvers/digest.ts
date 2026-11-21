import { z } from 'zod';
import type { DigestRunStatus } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result';
import type { JiraReader } from '../adapters/jira';
import { weeklyDigest, type WeeklyDigestDeps } from '../services/digest';
import { guarded, parseInput, readContext, type CallContext } from './context';

export interface DigestHandlerDeps {
  jira: Pick<JiraReader, 'isAdmin'>;
  digest: WeeklyDigestDeps;
}

export type DigestDepsFactory = (ctx: CallContext) => DigestHandlerDeps;

const RunInput = z.object({ confirmed: z.literal(true).optional() });

export function runDigestNowHandler(makeDeps: DigestDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<DigestRunStatus>> =>
    guarded('runDigestNow', async () => {
      const parsed = parseInput(RunInput, payload);
      if (!parsed.ok) return parsed;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm running the weekly digest first');
      }
      const deps = makeDeps(readContext(context));
      if (!(await deps.jira.isAdmin())) {
        return err('NOT_ADMIN', 'Only Jira admins can run the weekly digest');
      }
      return ok(await weeklyDigest(deps.digest, { manual: true }));
    });
}
