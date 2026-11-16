import { addDays, isoDay } from '../core/dates.js';
import type { AuditStore, HistoryStore } from '../adapters/storage.js';

export const HISTORY_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 180;

export interface NightlyMaintenanceDeps {
  history: Pick<HistoryStore, 'purgeBefore'>;
  audit: Pick<AuditStore, 'purgeBefore'>;
  clock: () => Date;
}

export async function nightlyMaintenance(
  deps: NightlyMaintenanceDeps,
): Promise<{ history: number; audit: number }> {
  const now = deps.clock();
  const [history, audit] = await Promise.all([
    deps.history.purgeBefore(isoDay(addDays(now, -HISTORY_RETENTION_DAYS))),
    deps.audit.purgeBefore(addDays(now, -AUDIT_RETENTION_DAYS).toISOString()),
  ]);
  return { history, audit };
}
