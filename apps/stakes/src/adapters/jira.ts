import api, { route } from '@forge/api';
import type { IssueKey } from '@stakes/contracts';

export interface IssueBasics {
  key: IssueKey;
  summary: string;
  status: string;
  url: string;
}

export interface JiraReader {
  // null when the issue doesn't exist or the caller can't see it; Jira answers 404 for both.
  issueBasics(issueKey: IssueKey): Promise<IssueBasics | null>;
}

type FetchLike = (path: ReturnType<typeof route>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function parseIssueBasics(issueKey: IssueKey, body: unknown): IssueBasics {
  const fields = (body as { fields?: { summary?: unknown; status?: { name?: unknown } } })?.fields;
  return {
    key: issueKey,
    summary: typeof fields?.summary === 'string' ? fields.summary : '',
    status: typeof fields?.status?.name === 'string' ? fields.status.name : '',
    url: `/browse/${issueKey}`,
  };
}

// Always reads as the calling user, so Rovo and MCP callers only ever see issues their
// own Jira permissions allow.
export function makeJiraReader(
  fetchAsUser: FetchLike = (path) => api.asUser().requestJira(path),
): JiraReader {
  return {
    async issueBasics(issueKey) {
      const res = await fetchAsUser(route`/rest/api/3/issue/${issueKey}?fields=summary,status`);
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`jira-issue-read failed with ${res.status}`);
      return parseIssueBasics(issueKey, await res.json());
    },
  };
}
