import type { DigestRunStatus } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import type { JiraReader } from '../adapters/jira.js';
import { weeklyDigest, type WeeklyDigestDeps } from '../services/digest.js';
import { guarded, readContext, type CallContext } from './context.js';

export interface DigestHandlerDeps {
  jira: Pick<JiraReader, 'isAdmin'>;
  digest: WeeklyDigestDeps;
}

export type DigestDepsFactory = (ctx: CallContext) => DigestHandlerDeps;

export function runDigestNowHandler(makeDeps: DigestDepsFactory) {
  return (_payload: unknown, context: unknown): Promise<Result<DigestRunStatus>> =>
    guarded('runDigestNow', async () => {
      const deps = makeDeps(readContext(context));
      if (!(await deps.jira.isAdmin())) {
        return err('NOT_ADMIN', 'Only Jira admins can run the weekly digest');
      }
      return ok(await weeklyDigest(deps.digest, { manual: true }));
    });
}
