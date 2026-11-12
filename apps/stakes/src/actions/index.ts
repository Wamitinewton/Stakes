import { IssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import { makeJiraReader, type JiraReader } from '../adapters/jira.js';

export interface IssueStakesAnswer {
  issueKey: string;
  summary: string;
  status: string;
  scored: false;
  note: string;
  sources: Array<{ title: string; url: string }>;
}

// Until the score engine exists this action proves the Rovo and MCP path: input
// validation, a permission-aware Jira read as the caller, and a structured answer
// with sources. It never invents a score.
export async function getIssueStakesAction(
  jira: JiraReader,
  payload: unknown,
): Promise<Result<IssueStakesAnswer>> {
  const raw = (payload as { issueKey?: unknown } | undefined)?.issueKey;
  const parsed = IssueKey.safeParse(typeof raw === 'string' ? raw.trim().toUpperCase() : raw);
  if (!parsed.success) return err('INVALID_INPUT', 'issueKey must look like PAY-142');

  const issue = await jira.issueBasics(parsed.data);
  if (!issue) return err('FORBIDDEN', `${parsed.data} does not exist or you cannot view it`);

  console.log('action get-issue-stakes', { issueKey: issue.key });
  return ok({
    issueKey: issue.key,
    summary: issue.summary,
    status: issue.status,
    scored: false,
    note: 'Stakes has not scored this issue yet. Do not estimate a score.',
    sources: [{ title: `${issue.key} in Jira`, url: issue.url }],
  });
}

export const getIssueStakes = (payload: unknown) => getIssueStakesAction(makeJiraReader(), payload);
