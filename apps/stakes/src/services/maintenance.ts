import { addDays, isoDay } from '../core/dates.js';
import type { AuditStore, HistoryStore, LlmStore } from '../adapters/storage.js';

export const HISTORY_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 180;
export const LLM_CACHE_UNUSED_DAYS = 30;
export const LLM_USAGE_RETENTION_DAYS = 30;
// Usage keys are named by day and cannot be listed, so each night deletes a week of
// days just past retention; a few missed nights still leave nothing behind.
const USAGE_SWEEP_DAYS = 7;

export interface NightlyMaintenanceDeps {
  history: Pick<HistoryStore, 'purgeBefore'>;
  audit: Pick<AuditStore, 'purgeBefore'>;
  llm: Pick<LlmStore, 'purgeCacheUnusedBefore' | 'deleteDay'>;
  clock: () => Date;
}

export interface NightlyResult {
  history: number;
  audit: number;
  llmCache: number;
}

export async function nightlyMaintenance(deps: NightlyMaintenanceDeps): Promise<NightlyResult> {
  const now = deps.clock();
  const oldDays = Array.from({ length: USAGE_SWEEP_DAYS }, (_, i) =>
    isoDay(addDays(now, -(LLM_USAGE_RETENTION_DAYS + 1 + i))),
  );
  const [history, audit, llmCache] = await Promise.all([
    deps.history.purgeBefore(isoDay(addDays(now, -HISTORY_RETENTION_DAYS))),
    deps.audit.purgeBefore(addDays(now, -AUDIT_RETENTION_DAYS).toISOString()),
    deps.llm.purgeCacheUnusedBefore(addDays(now, -LLM_CACHE_UNUSED_DAYS).toISOString()),
    ...oldDays.map((day) => deps.llm.deleteDay(day)),
  ]);
  return { history, audit, llmCache: llmCache as number };
}
