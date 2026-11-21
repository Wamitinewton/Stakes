import { createHash } from 'node:crypto';
import type { IssueKey, PanelView, Snapshot } from '@stakes/contracts';
import { suggestPriority } from '../core/bands';
import { confidence } from '../core/confidence';
import { addDays, isoDay } from '../core/dates';
import { detect, detectThresholds } from '../core/detect';
import { canonicalEvidence } from '../core/evidenceHash';
import { normalise } from '../core/normalise';
import { templateSummary, toPanelView } from '../core/panelView';
import { err, ok, type Result } from '../core/result';
import { score } from '../core/score';
import { rawSignals } from '../core/signals';
import type { StakesScoreField } from '../adapters/field';
import type { IssueDetails, JiraReader } from '../adapters/jira';
import type { TextWriter, WriteRequest } from '../adapters/llm';
import type {
  HistoryStore,
  MirrorStore,
  PercentileStore,
  SettingsStore,
  ShipNoticeStore,
  SnapshotStore,
} from '../adapters/storage';
import { collectEvidence, type CollectDeps } from './collect';
import { conversationExcerpts } from './prompts';
import { needsConsent } from '../core/consent';

export interface GetStakesDeps extends Omit<CollectDeps, 'jira' | 'mirror'> {
  jira: Pick<JiraReader, 'issue' | 'linkedRequests' | 'bridgeCrm'>;
  mirror: CollectDeps['mirror'] & Pick<MirrorStore, 'dealsVersion'>;
  snapshots: SnapshotStore;
  history: Pick<HistoryStore, 'record' | 'scoreOnOrBefore' | 'since'>;
  settings: Pick<SettingsStore, 'get'>;
  percentiles: Pick<PercentileStore, 'get'>;
  scoreField: Pick<StakesScoreField, 'set'>;
  writer: Pick<TextWriter, 'write'>;
  // Only the panel reads it, to show the ship notice banner.
  notices?: Pick<ShipNoticeStore, 'pendingFor'>;
}

export interface GetStakesOptions {
  refresh: boolean;
  // Ask the model for the "why it matters" summary. Only the issue panel does: the
  // backlog recomputes dozens of issues at a time and Rovo writes its own words, so
  // both keep the template and spend no credits.
  explain?: boolean;
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

export function summaryRequest(
  snapshot: Pick<Snapshot, 'evidence' | 'evidenceHash'>,
  issue: Pick<IssueDetails, 'key' | 'summary'>,
  fallback: { text: string; citedIds: string[] },
): WriteRequest {
  return {
    purpose: 'summary',
    cacheKey: `${snapshot.evidenceHash}:summary`,
    evidence: snapshot.evidence,
    context: { issueKey: issue.key, issueSummary: issue.summary },
    data: conversationExcerpts(snapshot.evidence),
    fallback,
  };
}

// The writer never throws, but a summary is decoration: if anything goes wrong the
// template stands and the score is still returned.
async function explain(deps: GetStakesDeps, req: WriteRequest): Promise<Snapshot['summary']> {
  try {
    const written = await deps.writer.write(req);
    return { text: written.text, generated: written.generated, citedIds: written.citedIds };
  } catch {
    return { ...req.fallback!, generated: false };
  }
}

export async function getStakes(
  deps: GetStakesDeps,
  issueKey: IssueKey,
  opts: GetStakesOptions,
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
    // A snapshot scored by the backlog carries the template; the first panel view
    // upgrades it to a generated summary and keeps that for everyone after.
    if (
      opts.explain &&
      settings.llmEnabled &&
      !cached.summary.generated &&
      cached.evidence.length > 0
    ) {
      const summary = await explain(deps, summaryRequest(cached, issue, cached.summary));
      if (summary.generated) {
        const upgraded = { ...cached, summary };
        await deps.snapshots.save(upgraded).catch(() => {
          console.warn('snapshot summary save failed', { issueKey });
        });
        return ok(upgraded);
      }
    }
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
  const template = templateSummary(
    { evidence: collected.evidence, raw, contributions: result.contributions },
    now,
  );
  const hash = evidenceHash(collected.evidence);
  const summary =
    opts.explain && collected.evidence.length > 0
      ? await explain(
          deps,
          summaryRequest({ evidence: collected.evidence, evidenceHash: hash }, issue, template),
        )
      : { ...template, generated: false };

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
    evidenceHash: hash,
    summary,
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
      deps.scoreField.set(issue.key, snapshot.score),
    ]);
  } catch (e) {
    if (needsConsent(e)) throw e;
    console.warn('snapshot save or field update failed', { issueKey });
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
  const [result, pending] = await Promise.all([
    getStakes(deps, issueKey, { ...opts, explain: true }),
    deps.notices?.pendingFor(issueKey).catch(() => null) ?? null,
  ]);
  if (!result.ok) return result;
  return ok({ ...toPanelView(result.data, deps.clock()), hasPendingShipNotice: pending !== null });
}
