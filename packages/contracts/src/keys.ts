import { z } from 'zod';

// Jira project keys start with a letter and allow letters, digits and underscores.
// Anchored so a crafted value can never smuggle extra JQL or a path segment.
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

export const ProjectKey = z.string().regex(PROJECT_KEY_PATTERN, 'Not a Jira project key');
export const IssueKey = z.string().regex(ISSUE_KEY_PATTERN, 'Not a Jira issue key');

export type ProjectKey = z.infer<typeof ProjectKey>;
export type IssueKey = z.infer<typeof IssueKey>;
export type AccountId = string;

export function isIssueKey(value: unknown): value is IssueKey {
  return typeof value === 'string' && ISSUE_KEY_PATTERN.test(value);
}

export function projectKeyOf(issueKey: IssueKey): ProjectKey {
  const dash = issueKey.lastIndexOf('-');
  return issueKey.slice(0, dash);
}
