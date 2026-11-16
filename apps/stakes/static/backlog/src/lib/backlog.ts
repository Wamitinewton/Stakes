import type { BacklogRow, IssueKey } from '@stakes/contracts';

export function batchesOf20(issueKeys: IssueKey[]): IssueKey[][] {
  const batches: IssueKey[][] = [];
  for (let index = 0; index < issueKeys.length; index += 20) {
    batches.push(issueKeys.slice(index, index + 20));
  }
  return batches;
}

export function mergeRows(current: BacklogRow[], recomputed: BacklogRow[]): BacklogRow[] {
  const replacements = new Map(recomputed.map((row) => [row.issueKey, row]));
  return current
    .map((row) => replacements.get(row.issueKey) ?? row)
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }),
    );
}
