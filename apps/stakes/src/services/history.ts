import type { IssueKey, ScoreHistory } from '@stakes/contracts';
import { addDays, isoDay } from '../core/dates.js';
import type { HistoryStore } from '../adapters/storage.js';

export interface GetHistoryDeps {
  history: Pick<HistoryStore, 'since'>;
  clock: () => Date;
}

export async function getHistory(
  deps: GetHistoryDeps,
  input: { issueKey: IssueKey; days: number },
): Promise<ScoreHistory> {
  const firstDay = isoDay(addDays(deps.clock(), -(input.days - 1)));
  const rows = await deps.history.since(input.issueKey, firstDay);
  return {
    points: rows.map((row) => ({ date: row.day, score: row.score })),
    jump: rows.at(-1)?.badges.includes('stakes-jump') ?? false,
  };
}
