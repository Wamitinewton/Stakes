import { createHash } from 'node:crypto';
import type { IssueKey, PanelView, Snapshot } from '@stakes/contracts';
import { suggestPriority } from '../core/bands.js';
import { confidence } from '../core/confidence.js';
import { addDays, isoDay } from '../core/dates.js';
import { detect, detectThresholds } from '../core/detect.js';
import { canonicalEvidence } from '../core/evidenceHash.js';
import { normalise } from '../core/normalise.js';
import { templateSummary, toPanelView } from '../core/panelView.js';
import { err, ok, type Result } from '../core/result.js';
import { score } from '../core/score.js';
import { rawSignals } from '../core/signals.js';
import type { JiraReader } from '../adapters/jira.js';
import type {
  HistoryStore,
  MirrorStore,
  PercentileStore,
  SettingsStore,
  SnapshotStore,
} from '../adapters/storage.js';
import { collectEvidence, type CollectDeps } from './collect.js';

export interface GetStakesDeps extends Omit<CollectDeps, 'jira' | 'mirror'> {
  jira: Pick<JiraReader, 'issue' | 'linkedRequests' | 'bridgeCrm'>;
  mirror: CollectDeps['mirror'] & Pick<MirrorStore, 'dealsVersion'>;
  snapshots: SnapshotStore;
  history: Pick<HistoryStore, 'record' | 'scoreOnOrBefore'>;
  settings: Pick<SettingsStore, 'get'>;
  percentiles: Pick<PercentileStore, 'get'>;
}

export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// A cached snapshot is reused only while nothing it depends on has moved: it is under
// six hours old, the issue has not been edited since, no CSV or demo import has
// changed the deals, and nobody has changed the weights.
export function isFresh(
  snapshot: Snapshot,
  now: Date,
  current: { issueUpdated: string; dealsVersion: number; weightsVersion: number },
): boolean {
  const computedAt = new Date(snapshot.computedAt).getTime();
  const updated = new Date(current.issueUpdated).getTime();
  return (
    now.getTime() - computedAt < SNAPSHOT_MAX_AGE_MS &&
    (Number.isNaN(updated) || updated <= computedAt) &&
    snapshot.dealsVersion === current.dealsVersion &&
    snapshot.weightsVersion === current.weightsVersion
  );
}

export function evidenceHash(evidence: Snapshot['evidence']): string {
  return createHash('sha256').update(canonicalEvidence(evidence)).digest('hex');
}

export async function getStakes(
  deps: GetStakesDeps,
  issueKey: IssueKey,
  opts: { refresh: boolean },
): Promise<Result<Snapshot>> {
  const now = deps.clock();
  const issue = await deps.jira.issue(issueKey);
  if (!issue) return err('NOT_FOUND', `${issueKey} does not exist or you cannot view it`);

  const [settings, dealsVersion, cached] = await Promise.all([
    deps.settings.get(),
    deps.mirror.dealsVersion(),
    deps.snapshots.latest(issueKey),
  ]);

  if (
    cached &&
    !opts.refresh &&
    isFresh(cached, now, {
      issueUpdated: issue.updated,
      dealsVersion,
      weightsVersion: settings.weightsVersion,
    })
  ) {
    return ok(cached);
  }

  const collected = await collectEvidence(deps, { key: issue.key, id: issue.id });
  const [percentiles, score7DaysAgo] = await Promise.all([
    deps.percentiles.get(issue.projectKey),
    deps.history.scoreOnOrBefore(issueKey, isoDay(addDays(now, -7))).catch(() => null),
  ]);

  const raw = rawSignals(collected.evidence, now);
  const norm = normalise(raw, percentiles, percentiles?.scoredCount ?? 0);
  const result = score(norm, settings.weights);
  const badges = detect({
    score: result.score,
    currentPriority: issue.priority,
    evidenceCount: collected.evidence.length,
    score7DaysAgo,
    thresholds: detectThresholds(settings.bands, settings.jumpThreshold),
  });
  const summary = templateSummary(
    { evidence: collected.evidence, raw, contributions: result.contributions },
    now,
  );

  const snapshot: Snapshot = {
    issueKey: issue.key,
    projectKey: issue.projectKey,
    score: result.score,
    confidence: confidence(collected.evidence, now),
    raw,
    normalised: norm,
    contributions: result.contributions,
    evidence: collected.evidence,
    currentPriority: issue.priority,
    suggestedPriority: suggestPriority(result.score, settings.bands),
    badges,
    weightsUsed: settings.weights,
    weightsVersion: settings.weightsVersion,
    dealsVersion,
    evidenceHash: evidenceHash(collected.evidence),
    summary: { text: summary.text, generated: false, citedIds: summary.citedIds },
    degraded: collected.degraded,
    hiddenItems: collected.hiddenItems,
    computedAt: now.toISOString(),
  };

  // A failed write costs a recompute on the next load, never the answer to this one.
  try {
    await Promise.all([
      deps.snapshots.save(snapshot),
      deps.history.record({
        issueKey: issue.key,
        projectKey: issue.projectKey,
        day: isoDay(now),
        score: snapshot.score,
        badges,
        source: 'computed',
      }),
    ]);
  } catch {
    console.warn('snapshot save failed', { issueKey });
  }

  console.log('stakes computed', {
    issueKey,
    score: snapshot.score,
    evidence: snapshot.evidence.length,
    degraded: snapshot.degraded.length,
    dealSource: collected.dealSource,
  });
  return ok(snapshot);
}

export async function getPanelView(
  deps: GetStakesDeps,
  issueKey: IssueKey,
  opts: { refresh: boolean },
): Promise<Result<PanelView>> {
  const result = await getStakes(deps, issueKey, opts);
  return result.ok ? ok(toPanelView(result.data, deps.clock())) : result;
}
