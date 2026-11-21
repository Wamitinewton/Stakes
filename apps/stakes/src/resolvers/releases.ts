import { z } from 'zod';
import { ProjectKey, type ReleaseView } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result';
import { releaseStakes, type ReleaseDeps } from '../services/releaseStakes';
import { guarded, parseInput, readContext, type CallContext } from './context';

export type ReleaseDepsFactory = (ctx: CallContext) => { release: ReleaseDeps };

const ReleaseInput = z.object({
  projectKey: z.string().trim().toUpperCase().pipe(ProjectKey),
  versionId: z.string().trim().regex(/^\d+$/).optional(),
});

export function getReleaseStakesHandler(makeDeps: ReleaseDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<ReleaseView>> =>
    guarded('getReleaseStakes', async () => {
      const parsed = parseInput(ReleaseInput, payload);
      if (!parsed.ok) return parsed;
      const release = await releaseStakes(
        makeDeps(readContext(context)).release,
        parsed.data.projectKey,
        parsed.data.versionId,
      );
      return release
        ? ok(release)
        : err('NOT_FOUND', 'Select an unreleased version in this project');
    });
}
