import {
  BAND_NAMES,
  SIGNAL_KEYS,
  type Bands,
  type LlmUsageView,
  type Settings,
  type SettingsView,
  type Weights,
} from '@stakes/contracts';
import { err, ok, type Result } from '../core/result';
import { renormaliseWeights } from '../core/score';
import type { ConfluenceAdapter } from '../adapters/confluence';
import type { JiraReader } from '../adapters/jira';
import type {
  ConnectionStore,
  DigestStore,
  LlmStore,
  SeedStore,
  SettingsStore,
} from '../adapters/storage';

export interface SettingsDeps {
  jira: Pick<JiraReader, 'isAdmin' | 'priorities' | 'projects'>;
  settings: SettingsStore;
  connections: Pick<ConnectionStore, 'get'>;
  confluence: Pick<ConfluenceAdapter, 'isConnected' | 'parentPages'>;
  digest: Pick<DigestStore, 'lastRun'>;
  seed: Pick<SeedStore<unknown>, 'status'>;
}

export async function getSettingsView(deps: SettingsDeps): Promise<Result<SettingsView>> {
  const [
    settings,
    isAdmin,
    priorities,
    projects,
    connectionId,
    confluenceConnected,
    digestLastRun,
    seed,
  ] = await Promise.all([
    deps.settings.get(),
    deps.jira.isAdmin(),
    deps.jira.priorities().catch(() => [] as string[]),
    deps.jira.projects().catch(() => []),
    deps.connections.get(),
    deps.confluence.isConnected().catch(() => false),
    deps.digest.lastRun(),
    deps.seed.status(),
  ]);
  const confluencePages = confluenceConnected
    ? await deps.confluence.parentPages().catch(() => [])
    : [];
  return ok({
    settings,
    isAdmin,
    priorities,
    projects,
    connectorConnected: connectionId !== null,
    confluenceConnected,
    confluencePages,
    digestLastRun,
    seed,
  });
}

export interface SettingsChange {
  weights?: Weights;
  bands?: Bands;
  jumpThreshold?: number;
  projectsInScope?: string[];
  llmEnabled?: boolean;
  dailyLlmBudgetCredits?: number;
  digestEnabled?: boolean;
  digestParentPageId?: string | null;
}

export async function getLlmUsage(
  deps: { settings: Pick<SettingsStore, 'get'>; llm: Pick<LlmStore, 'usage' | 'rejections'> },
  now: Date,
): Promise<LlmUsageView> {
  const day = now.toISOString().slice(0, 10);
  const [settings, today, rejections] = await Promise.all([
    deps.settings.get(),
    deps.llm.usage(day),
    deps.llm.rejections(day),
  ]);
  return {
    enabled: settings.llmEnabled,
    budget: settings.dailyLlmBudgetCredits,
    day,
    today: { ...today, credits: Math.round(today.credits * 100) / 100 },
    rejections,
  };
}

const sameWeights = (a: Weights, b: Weights) =>
  SIGNAL_KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);

export function validateBands(bands: Bands, sitePriorities: string[]): string | null {
  const t = bands.thresholds;
  const ordered = [t.highest, t.high, t.medium, t.low];
  if (ordered.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) {
    return 'Band thresholds must be whole numbers from 1 to 100';
  }
  if (!(t.highest > t.high && t.high > t.medium && t.medium > t.low)) {
    return 'Each band must start above the one below it';
  }
  const known = new Set(sitePriorities.map((p) => p.toLowerCase()));
  for (const band of BAND_NAMES) {
    const name = bands.priorities[band];
    if (name !== null && sitePriorities.length > 0 && !known.has(name.toLowerCase())) {
      return `${name} is not a priority on this site`;
    }
  }
  return null;
}

// Weights are stored renormalised, so the panel and the score always agree on what each
// signal is worth. Any change to them bumps the version, which makes every cached
// snapshot stale on its next read.
export async function saveSettings(
  deps: SettingsDeps,
  change: SettingsChange,
): Promise<Result<Settings>> {
  const current = await deps.settings.get();
  const next: Settings = { ...current };

  if (change.weights) {
    try {
      next.weights = renormaliseWeights(change.weights);
    } catch (e) {
      return err('INVALID_INPUT', e instanceof Error ? e.message : 'Invalid weights');
    }
    if (!sameWeights(next.weights, current.weights))
      next.weightsVersion = current.weightsVersion + 1;
  }
  if (change.bands) {
    const problem = validateBands(change.bands, await deps.jira.priorities().catch(() => []));
    if (problem) return err('INVALID_INPUT', problem);
    next.bands = change.bands;
    // Bands decide the suggested priority and the badges, which live in the snapshot.
    if (JSON.stringify(change.bands) !== JSON.stringify(current.bands)) {
      next.weightsVersion = Math.max(next.weightsVersion, current.weightsVersion + 1);
    }
  }
  if (change.jumpThreshold !== undefined) next.jumpThreshold = change.jumpThreshold;
  if (change.projectsInScope) next.projectsInScope = [...new Set(change.projectsInScope)];
  // The writer reads these on every call, so they apply from the next generation.
  if (change.llmEnabled !== undefined) next.llmEnabled = change.llmEnabled;
  if (change.dailyLlmBudgetCredits !== undefined) {
    next.dailyLlmBudgetCredits = change.dailyLlmBudgetCredits;
  }
  if (change.digestEnabled !== undefined) next.digestEnabled = change.digestEnabled;
  if (change.digestParentPageId !== undefined) next.digestParentPageId = change.digestParentPageId;
  if (next.digestEnabled && !next.digestParentPageId) {
    return err('INVALID_INPUT', 'Choose a parent page before turning on the weekly digest');
  }

  await deps.settings.save(next);
  console.log('settings saved', {
    weightsVersion: next.weightsVersion,
    projects: next.projectsInScope.length,
    llmEnabled: next.llmEnabled,
  });
  return ok(next);
}
