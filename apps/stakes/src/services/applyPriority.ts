import { randomUUID } from 'node:crypto';
import type {
  ApplyPriorityResult,
  EvidenceItem,
  PriorityChange,
  Snapshot,
} from '@stakes/contracts';
import { JiraError, type JiraReader } from '../adapters/jira';
import type { JiraWriter } from '../adapters/jiraWriter';
import type { AuditStore, SnapshotStore } from '../adapters/storage';
import { needsConsent } from '../core/consent';

export interface ApplyPriorityDeps {
  jira: Pick<JiraReader, 'canView' | 'issue'>;
  writer: Pick<JiraWriter, 'updateIssue' | 'addComment'>;
  snapshots: Pick<SnapshotStore, 'latest'>;
  audit: Pick<AuditStore, 'record'>;
  clock: () => Date;
}

export function topAuditEvidence(snapshot: Snapshot): EvidenceItem[] {
  const cited = snapshot.summary.citedIds
    .map((id) => snapshot.evidence.find((e) => e.id === id))
    .filter((e): e is EvidenceItem => e !== undefined);
  const seen = new Set(cited.map((e) => e.id));
  return [...cited, ...snapshot.evidence.filter((e) => !seen.has(e.id))].slice(0, 3);
}

export function priorityAuditComment(
  change: PriorityChange,
  score: number,
  topEvidence: EvidenceItem[],
  actorAccountId: string,
) {
  return {
    type: 'doc' as const,
    version: 1 as const,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Stakes priority: ${change.from} → ${change.to}. Stakes Score: ${score}.`,
          },
        ],
      },
      ...(topEvidence.length > 0
        ? [
            {
              type: 'bulletList',
              content: topEvidence.map((e) => ({
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: e.title,
                        marks: [{ type: 'link', attrs: { href: e.url } }],
                      },
                    ],
                  },
                ],
              })),
            },
          ]
        : []),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Approved by ' },
          { type: 'mention', attrs: { id: actorAccountId } },
          { type: 'text', text: ' via Stakes' },
        ],
      },
    ],
  };
}

function failureCode(error: unknown): ApplyPriorityResult['failed'][number]['code'] {
  if (error instanceof JiraError) {
    if (error.status === 403) return 'FORBIDDEN';
    if (error.status === 404) return 'NOT_FOUND';
  }
  return 'UPSTREAM_DEGRADED';
}

export async function applyPriority(
  deps: ApplyPriorityDeps,
  changes: PriorityChange[],
  actorAccountId: string,
): Promise<ApplyPriorityResult> {
  const result: ApplyPriorityResult = { applied: [], failed: [] };

  for (const change of changes) {
    try {
      if (!(await deps.jira.canView(change.issueKey))) {
        result.failed.push({ issueKey: change.issueKey, code: 'FORBIDDEN' });
        continue;
      }
      const issue = await deps.jira.issue(change.issueKey);
      if (!issue) {
        result.failed.push({ issueKey: change.issueKey, code: 'NOT_FOUND' });
        continue;
      }
      if (issue.priority !== change.from) {
        result.failed.push({ issueKey: change.issueKey, code: 'STALE_PREVIEW' });
        continue;
      }
      const snapshot = await deps.snapshots.latest(change.issueKey);
      if (!snapshot) {
        result.failed.push({ issueKey: change.issueKey, code: 'STALE_PREVIEW' });
        continue;
      }

      const topEvidence = topAuditEvidence(snapshot);
      await deps.writer.updateIssue(change.issueKey, { priority: change.to });
      await deps.writer.addComment(
        change.issueKey,
        priorityAuditComment(change, snapshot.score, topEvidence, actorAccountId),
      );
      await deps.audit.record({
        id: randomUUID(),
        issueKey: change.issueKey,
        kind: 'priority',
        from: change.from,
        to: change.to,
        score: snapshot.score,
        topEvidence,
        actorAccountId,
        at: deps.clock().toISOString(),
      });
      result.applied.push(change.issueKey);
    } catch (error) {
      if (needsConsent(error)) throw error;
      result.failed.push({ issueKey: change.issueKey, code: failureCode(error) });
    }
  }

  console.log('priority apply finished', {
    applied: result.applied.length,
    failed: result.failed.length,
    actorAccountId,
  });
  return result;
}
