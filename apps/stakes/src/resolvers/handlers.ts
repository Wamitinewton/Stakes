import { z } from 'zod';
import { IssueKey, type CsvPreview, type ImportResult, type PanelView } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import type { JiraReader } from '../adapters/jira.js';
import { getPanelView, type GetStakesDeps } from '../services/getStakes.js';
import { importCsv, previewCsv, type ImportDeps } from '../services/importCsv.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export interface HandlerDeps {
  stakes: GetStakesDeps;
  jira: Pick<JiraReader, 'canView' | 'isAdmin'>;
  importer: ImportDeps;
}

export type DepsFactory = (ctx: CallContext) => HandlerDeps;

const GetStakesInput = z.object({
  issueKey: z.string().trim().toUpperCase().pipe(IssueKey),
  refresh: z.boolean().optional(),
});

export function getStakesHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<PanelView>> =>
    guarded('getStakes', async () => {
      const parsed = parseInput(GetStakesInput, payload);
      if (!parsed.ok) return parsed;
      const { issueKey, refresh } = parsed.data;
      const deps = makeDeps(readContext(context));
      if (!(await deps.jira.canView(issueKey))) {
        return err('FORBIDDEN', `You don't have access to ${issueKey}`);
      }
      return getPanelView(deps.stakes, issueKey, { refresh: refresh === true });
    });
}

// Pasted files are capped a little above the 1 MB the parser accepts, so an oversized
// paste gets the parser's clear message instead of a schema error.
const csvText = z.string().max(1_200_000).optional();
const CsvInput = z.object({ customersCsv: csvText, dealsCsv: csvText });
const ImportInput = CsvInput.extend({ confirmed: z.literal(true).optional() });

async function requireAdmin(deps: HandlerDeps): Promise<Result<true>> {
  return (await deps.jira.isAdmin()) ? ok(true) : err('NOT_ADMIN', 'Only Jira admins can do this');
}

export function previewCsvHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<CsvPreview>> =>
    guarded('previewCsv', async () => {
      const parsed = parseInput(CsvInput, payload);
      if (!parsed.ok) return parsed;
      const admin = await requireAdmin(makeDeps(readContext(context)));
      if (!admin.ok) return admin;
      return ok(previewCsv(parsed.data));
    });
}

export function importCsvHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<ImportResult>> =>
    guarded('importCsv', async () => {
      const parsed = parseInput(ImportInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context));
      const admin = await requireAdmin(deps);
      if (!admin.ok) return admin;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm the import first');
      }
      return importCsv(deps.importer, parsed.data);
    });
}
