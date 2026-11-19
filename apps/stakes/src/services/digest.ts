import {
  formatDate,
  formatUsd,
  type DigestRunStatus,
  type DigestSkipReason,
  type EvidenceItem,
  type ProjectKey,
  type Snapshot,
} from '@stakes/contracts';
import type { ConfluenceAdapter } from '../adapters/confluence.js';
import type { TextWriter } from '../adapters/llm.js';
import type {
  DigestStore,
  SettingsStore,
  ShipNotice,
  ShipNoticeStore,
  SnapshotStore,
} from '../adapters/storage.js';
import { addDays, isoDay } from '../core/dates.js';
import { openDeals } from '../core/signals.js';

export interface WeeklyDigestDeps {
  settings: Pick<SettingsStore, 'get'>;
  snapshots: Pick<SnapshotStore, 'forProject'>;
  notices: Pick<ShipNoticeStore, 'sentSince'>;
  digest: Pick<DigestStore, 'lastPage' | 'saveLastPage' | 'saveRun'>;
  confluence: ConfluenceAdapter;
  writer: Pick<TextWriter, 'write'>;
  clock: () => Date;
}

export interface DigestIssue {
  issueKey: string;
  score: number;
  priority: string;
  revenueUsd: number;
}

export interface DigestFix {
  issueKey: string;
  versionName: string | null;
  sentAt: string;
}

export interface DigestPage {
  title: string;
  body: string;
}

export function shouldRunWeeklyDigest(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() >= 6;
}

export function digestWeekStart(now: Date): string {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return isoDay(addDays(now, -daysSinceMonday));
}

const byScore = (a: Snapshot, b: Snapshot) =>
  b.score - a.score || a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true });

function digestIssue(snapshot: Snapshot): DigestIssue {
  return {
    issueKey: snapshot.issueKey,
    score: snapshot.score,
    priority: snapshot.currentPriority,
    revenueUsd: snapshot.raw.R ?? 0,
  };
}

function projectOf(issueKey: string): string {
  return issueKey.slice(0, issueKey.lastIndexOf('-'));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char]!;
  });
}

function issueRows(issues: DigestIssue[], revenue: boolean): string {
  if (issues.length === 0) return '<p>None this week.</p>';
  return `<table><tbody><tr><th>Issue</th><th>Score</th><th>Priority</th>${
    revenue ? '<th>Revenue at risk</th>' : ''
  }</tr>${issues
    .map(
      (issue) =>
        `<tr><td>${escapeXml(issue.issueKey)}</td><td>${issue.score}</td><td>${escapeXml(
          issue.priority,
        )}</td>${revenue ? `<td>${formatUsd(issue.revenueUsd)}</td>` : ''}</tr>`,
    )
    .join('')}</tbody></table>`;
}

export function buildDigestPage(input: {
  projectKey: ProjectKey;
  weekStart: string;
  intro: string;
  silentFires: DigestIssue[];
  fixes: DigestFix[];
  revenueUnblockedUsd: number;
  unblockedDealCount: number;
  phantoms: DigestIssue[];
}): DigestPage {
  const fixes = input.fixes.length
    ? `<ul>${input.fixes
        .map(
          (fix) =>
            `<li><strong>${escapeXml(fix.issueKey)}</strong>${
              fix.versionName ? ` · ${escapeXml(fix.versionName)}` : ''
            } · ${formatDate(fix.sentAt)}</li>`,
        )
        .join('')}</ul>`
    : '<p>No fixes were shipped in the last seven days.</p>';
  const body = [
    `<p>${escapeXml(input.intro)}</p>`,
    '<h2>Top silent fires</h2>',
    issueRows(input.silentFires, true),
    '<h2>Fixes shipped in the last seven days</h2>',
    fixes,
    '<h2>Revenue unblocked</h2>',
    `<p>${formatUsd(input.revenueUnblockedUsd)} across ${input.unblockedDealCount} open deals.</p>`,
    '<h2>Phantom priorities still open</h2>',
    issueRows(input.phantoms, false),
  ].join('');
  return {
    title: `Stakes weekly digest · ${input.projectKey} · ${input.weekStart}`,
    body,
  };
}

function noticeFix(notice: ShipNotice): DigestFix | null {
  if (!notice.sentAt) return null;
  return {
    issueKey: notice.issueKey,
    versionName: notice.versionName,
    sentAt: notice.sentAt,
  };
}

export async function weeklyDigest(
  deps: WeeklyDigestDeps,
  options: { manual?: boolean } = {},
): Promise<DigestRunStatus> {
  const now = deps.clock();
  const settings = await deps.settings.get();

  async function skipped(reason: DigestSkipReason): Promise<DigestRunStatus> {
    const status: DigestRunStatus = {
      at: now.toISOString(),
      status: 'skipped',
      reason,
      created: 0,
      updated: 0,
      failed: 0,
    };
    await deps.digest.saveRun(status);
    return status;
  }

  if (!options.manual && !settings.digestEnabled) return skipped('digest-disabled');
  if (!(await deps.confluence.isConnected())) return skipped('confluence-not-connected');
  if (!settings.digestParentPageId) return skipped('parent-not-configured');

  const since = addDays(now, -7).toISOString();
  const sent = await deps.notices.sentSince(since);
  const status: DigestRunStatus = {
    at: now.toISOString(),
    status: 'completed',
    reason: null,
    created: 0,
    updated: 0,
    failed: 0,
  };

  for (const projectKey of settings.projectsInScope) {
    try {
      const snapshots = await deps.snapshots.forProject(projectKey);
      const fixes = sent
        .filter((notice) => projectOf(notice.issueKey) === projectKey)
        .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
      const shippedKeys = new Set(fixes.map((notice) => notice.issueKey));
      const openSnapshots = snapshots.filter((snapshot) => !shippedKeys.has(snapshot.issueKey));
      const silent = openSnapshots
        .filter((snapshot) => snapshot.badges.includes('silent-fire'))
        .sort(byScore)
        .slice(0, 5);
      const phantoms = openSnapshots
        .filter((snapshot) => snapshot.badges.includes('phantom'))
        .sort(byScore);
      const byIssue = new Map(snapshots.map((snapshot) => [snapshot.issueKey, snapshot]));
      const shippedSnapshots = fixes
        .map((notice) => byIssue.get(notice.issueKey))
        .filter((snapshot): snapshot is Snapshot => snapshot !== undefined);
      const unblockedDeals = openDeals(shippedSnapshots.flatMap((snapshot) => snapshot.evidence));
      const revenueUnblockedUsd = unblockedDeals.reduce((sum, deal) => sum + deal.amountUsd, 0);

      const evidence = new Map<string, EvidenceItem>();
      for (const snapshot of [...silent, ...phantoms, ...shippedSnapshots]) {
        for (const item of snapshot.evidence) evidence.set(item.id, item);
      }
      const weekStart = digestWeekStart(now);
      const intro = await deps.writer.write({
        purpose: 'digest',
        cacheKey: `${projectKey}:${weekStart}:digest`,
        evidence: [...evidence.values()],
        context: { issueKey: projectKey },
        fallback: {
          text: 'This week’s digest covers the highest-stakes work, shipped fixes and priorities that still need evidence.',
          citedIds: [],
        },
      });
      const page = buildDigestPage({
        projectKey,
        weekStart,
        intro: intro.text,
        silentFires: silent.map(digestIssue),
        fixes: fixes.map(noticeFix).filter((fix): fix is DigestFix => fix !== null),
        revenueUnblockedUsd,
        unblockedDealCount: unblockedDeals.length,
        phantoms: phantoms.map(digestIssue),
      });
      const previous = await deps.digest.lastPage(projectKey);
      const saved =
        previous?.weekStart === weekStart
          ? await deps.confluence.updatePage(previous.pageId, page.title, page.body)
          : await deps.confluence.createPage(settings.digestParentPageId, page.title, page.body);
      if (previous?.weekStart === weekStart) status.updated++;
      else status.created++;
      await deps.digest.saveLastPage(projectKey, { pageId: saved.id, weekStart });
    } catch (error) {
      status.failed++;
      console.warn('weekly digest project failed', {
        projectKey,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  await deps.digest.saveRun(status);
  return status;
}
