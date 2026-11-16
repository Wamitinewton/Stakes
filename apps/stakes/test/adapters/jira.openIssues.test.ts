import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, fixture, forgeApiMock } from '../fakes/jira.js';

vi.mock('@forge/api', () => forgeApiMock());
const { makeJiraReader } = await import('../../src/adapters/jira.js');
const SITE = 'https://example.atlassian.net';

describe('openIssues', () => {
  it('reads open project issues and follows the next page token', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/field': { status: 200, body: fixture('fields') },
      'POST /rest/api/3/search/jql': (body) => {
        const request = body as { nextPageToken?: string };
        return {
          status: 200,
          body: request.nextPageToken
            ? { issues: [fixture('issue.empty')] }
            : { issues: [fixture('issue.happy')], nextPageToken: 'page-2' },
        };
      },
    });

    const issues = await makeJiraReader(SITE, http).openIssues('PAY');

    expect(issues.map((issue) => issue.key)).toEqual(['PAY-142', 'PAY-150']);
    expect(calls[1]!.body).toMatchObject({
      jql: 'project = "PAY" AND statusCategory != Done ORDER BY key ASC',
      maxResults: 100,
    });
    expect(calls[2]!.body).toMatchObject({ nextPageToken: 'page-2' });
  });

  it('returns an empty project', async () => {
    const { http } = fakeHttp({
      'POST /rest/api/3/search/jql': { status: 200, body: { issues: [] } },
    });
    expect(await makeJiraReader(SITE, http).openIssues('PAY')).toEqual([]);
  });

  it('throws when Jira rejects the search', async () => {
    const { http } = fakeHttp({ 'POST /rest/api/3/search/jql': { status: 500 } });
    await expect(makeJiraReader(SITE, http).openIssues('PAY')).rejects.toThrow(
      'jira-open-issues failed with HTTP 500',
    );
  });
});
