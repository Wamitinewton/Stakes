import { z } from 'zod';
import {
  IssueKey,
  ProjectKey,
  type BadgeView,
  type CsvPreview,
  type ImportResult,
  type PanelView,
  type ScoreHistory,
  type SeedStatus,
  type Settings,
  type SettingsView,
} from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import type { JiraReader } from '../adapters/jira.js';
import { getBadge } from '../services/getBadge.js';
import { getPanelView, type GetStakesDeps } from '../services/getStakes.js';
import { getHistory } from '../services/history.js';
import { importCsv, previewCsv, type ImportDeps } from '../services/importCsv.js';
import { removeDemo, seedDemo, type SeedDeps } from '../services/seed.js';
import { getSettingsView, saveSettings, type SettingsDeps } from '../services/settings.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export interface HandlerDeps {
  stakes: GetStakesDeps;
  jira: Pick<JiraReader, 'canView' | 'isAdmin'>;
  importer: ImportDeps;
  seeder: SeedDeps;
  settings: SettingsDeps;
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

const GetHistoryInput = z.object({
  issueKey: z.string().trim().toUpperCase().pipe(IssueKey),
  days: z.number().int().min(1).max(30).optional(),
});

export function getHistoryHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<ScoreHistory>> =>
    guarded('getHistory', async () => {
      const parsed = parseInput(GetHistoryInput, payload);
      if (!parsed.ok) return parsed;
      const { issueKey, days } = parsed.data;
      const deps = makeDeps(readContext(context));
      if (!(await deps.jira.canView(issueKey))) {
        return err('FORBIDDEN', `You don't have access to ${issueKey}`);
      }
      return ok(await getHistory(deps.stakes, { issueKey, days: days ?? 30 }));
    });
}

const GetBadgeInput = z.object({
  issueKey: z.string().trim().toUpperCase().pipe(IssueKey),
});

export function getBadgeHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<BadgeView>> =>
    guarded('getBadge', async () => {
      const parsed = parseInput(GetBadgeInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context));
      return getBadge(deps.stakes, parsed.data.issueKey);
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

const SeedInput = z.object({
  softwareProjectKey: z.string().trim().toUpperCase().pipe(ProjectKey),
  serviceProjectKey: z.string().trim().toUpperCase().pipe(ProjectKey),
  confirmed: z.literal(true).optional(),
});

// Loading the demo writes 40 issues to Jira as the admin, so it needs the same explicit
// confirmation as any other write. The settings page calls this repeatedly until the
// status says loaded; each call resumes where the last stopped.
export function seedDemoHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<SeedStatus>> =>
    guarded('seedDemo', async () => {
      const parsed = parseInput(SeedInput, payload);
      if (!parsed.ok) return parsed;
      const ctx = readContext(context);
      const deps = makeDeps(ctx);
      const admin = await requireAdmin(deps);
      if (!admin.ok) return admin;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm loading the demo data first');
      }
      return seedDemo(deps.seeder, {
        softwareProjectKey: parsed.data.softwareProjectKey,
        serviceProjectKey: parsed.data.serviceProjectKey,
        accountId: ctx.accountId,
      });
    });
}

export function getSeedStatusHandler(makeDeps: DepsFactory) {
  return (_payload: unknown, context: unknown): Promise<Result<SeedStatus>> =>
    guarded('getSeedStatus', async () => {
      const deps = makeDeps(readContext(context));
      const admin = await requireAdmin(deps);
      if (!admin.ok) return admin;
      return ok(await deps.seeder.seed.status());
    });
}

const RemoveInput = z.object({ confirmed: z.literal(true).optional() });

export function removeDemoHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown) =>
    guarded('removeDemo', async () => {
      const parsed = parseInput(RemoveInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context));
      const admin = await requireAdmin(deps);
      if (!admin.ok) return admin;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm removing the demo data first');
      }
      return removeDemo(deps.seeder);
    });
}

// Anyone who can open the admin page can read the settings; the page turns its
// controls off for non-admins. Saving checks again here, because hiding a button is
// not access control.
export function getSettingsHandler(makeDeps: DepsFactory) {
  return (_payload: unknown, context: unknown): Promise<Result<SettingsView>> =>
    guarded('getSettings', async () => getSettingsView(makeDeps(readContext(context)).settings));
}

const weight = z.number().min(0).max(1000);
const SettingsInput = z.object({
  weights: z
    .object({ R: weight, S: weight, C: weight, H: weight, G: weight, U: weight })
    .optional(),
  bands: z
    .object({
      thresholds: z.object({
        highest: z.number(),
        high: z.number(),
        medium: z.number(),
        low: z.number(),
      }),
      priorities: z.object({
        highest: z.string().min(1).nullable(),
        high: z.string().min(1).nullable(),
        medium: z.string().min(1).nullable(),
        low: z.string().min(1).nullable(),
        lowest: z.string().min(1).nullable(),
      }),
    })
    .optional(),
  jumpThreshold: z.number().int().min(1).max(100).optional(),
  projectsInScope: z.array(ProjectKey).max(50).optional(),
});

export function saveSettingsHandler(makeDeps: DepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<Settings>> =>
    guarded('saveSettings', async () => {
      const parsed = parseInput(SettingsInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context));
      const admin = await requireAdmin(deps);
      if (!admin.ok) return admin;
      return saveSettings(deps.settings, parsed.data);
    });
}
