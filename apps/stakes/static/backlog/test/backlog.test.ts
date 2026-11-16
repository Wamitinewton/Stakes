import { describe, expect, it } from 'vitest';
import type { BacklogRow } from '@stakes/contracts';
import { batchesOf20, mergeRows } from '../src/lib/backlog';

const row = (issueKey: string, score: number | null): BacklogRow => ({
  issueKey,
  summary: issueKey,
  status: 'To Do',
  assignee: null,
  score,
  currentPriority: 'Medium',
  suggestedPriority: null,
  revenueUsd: 0,
  customers: 0,
  tickets: 0,
  badges: [],
  trend: 'flat',
  storyPoints: null,
  fixVersions: [],
  components: [],
});

describe('progressive scoring', () => {
  it('splits work into batches of at most 20', () => {
    const keys = Array.from({ length: 45 }, (_, index) => `PAY-${index + 1}`);
    expect(batchesOf20(keys).map((batch) => batch.length)).toEqual([20, 20, 5]);
  });

  it('merges recomputed rows and keeps the ranking by score', () => {
    const merged = mergeRows([row('PAY-1', 20), row('PAY-2', null)], [row('PAY-2', 80)]);
    expect(merged.map((r) => [r.issueKey, r.score])).toEqual([
      ['PAY-2', 80],
      ['PAY-1', 20],
    ]);
  });
});
