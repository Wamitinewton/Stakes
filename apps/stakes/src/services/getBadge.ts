import { type Badge, type BadgeView, type IssueKey } from '@stakes/contracts';
import { ok, type Result } from '../core/result';
import type { SnapshotStore } from '../adapters/storage';

export interface GetBadgeDeps {
  snapshots: Pick<SnapshotStore, 'latest'>;
}

const BADGE_LABEL: Record<Badge, string> = {
  'silent-fire': 'Silent fire',
  phantom: 'Phantom priority',
  'stakes-jump': 'Stakes jump',
};

export async function getBadge(deps: GetBadgeDeps, issueKey: IssueKey): Promise<Result<BadgeView>> {
  const snapshot = await deps.snapshots.latest(issueKey);
  if (!snapshot) return ok({ text: 'Not scored yet · Open the Stakes issue panel' });
  const badge = snapshot.badges[0];
  return ok({ text: badge ? `${snapshot.score} · ${BADGE_LABEL[badge]}` : String(snapshot.score) });
}
