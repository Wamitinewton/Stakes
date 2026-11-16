import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, fixture, forgeApiMock } from '../fakes/jira.js';

vi.mock('@forge/api', () => forgeApiMock());

const { getIssueStakesAction } = await import('../../src/actions/index.js');
const { makeJiraReader } = await import('../../src/adapters/jira.js');

const reader = (reply: { status: number; body?: unknown }) => {
  const fake = fakeHttp({ 'GET /rest/api/3/issue/': reply });
  return { jira: makeJiraReader('', fake.http), calls: fake.calls };
};

describe('get-issue-stakes action', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});

  it('answers with the issue and a source link, without inventing a score', async () => {
    const { jira, calls } = reader({ status: 200, body: fixture('issue.happy') });
    const result = await getIssueStakesAction(jira, { issueKey: ' pay-142 ' });
    expect(calls.at(-1)!.path).toMatch(/^\/rest\/api\/3\/issue\/PAY-142\?fields=/);
    expect(result).toEqual({
      ok: true,
      data: {
        issueKey: 'PAY-142',
        summary: 'CSV export times out above 10k rows',
        status: 'To Do',
        scored: false,
        note: 'Stakes has not scored this issue yet. Do not estimate a score.',
        sources: [{ title: 'PAY-142 in Jira', url: '/browse/PAY-142' }],
      },
    });
  });

  it('rejects a malformed key before calling Jira', async () => {
    const { jira, calls } = reader({ status: 200, body: fixture('issue.happy') });
    const result = await getIssueStakesAction(jira, { issueKey: 'PAY-1 OR 1=1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(calls).toHaveLength(0);
  });

  it('reports an issue the caller cannot see as forbidden', async () => {
    const result = await getIssueStakesAction(reader({ status: 404 }).jira, { issueKey: 'PAY-9' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('throws on an unexpected Jira failure so it shows in the logs', async () => {
    await expect(
      getIssueStakesAction(reader({ status: 500 }).jira, { issueKey: 'PAY-9' }),
    ).rejects.toThrow('jira-issue-read failed with HTTP 500');
  });
});
