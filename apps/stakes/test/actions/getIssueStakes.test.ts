import { describe, expect, it, vi } from 'vitest';
import issue from '../fixtures/jira/issue.happy.json';

vi.mock('@forge/api', () => ({
  default: { asUser: vi.fn() },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), ''),
}));

const { getIssueStakesAction } = await import('../../src/actions/index.js');
const { makeJiraReader } = await import('../../src/adapters/jira.js');

const respond = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('get-issue-stakes action', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});

  it('answers with the issue and a source link, without inventing a score', async () => {
    const fetch = respond(200, issue);
    const result = await getIssueStakesAction(makeJiraReader(fetch), { issueKey: ' pay-142 ' });
    expect(fetch).toHaveBeenCalledWith('/rest/api/3/issue/PAY-142?fields=summary,status');
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
    const fetch = respond(200, issue);
    const result = await getIssueStakesAction(makeJiraReader(fetch), { issueKey: 'PAY-1 OR 1=1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an issue the caller cannot see as forbidden', async () => {
    const result = await getIssueStakesAction(makeJiraReader(respond(404)), {
      issueKey: 'PAY-9',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('throws on an unexpected Jira failure so it shows in the logs', async () => {
    await expect(
      getIssueStakesAction(makeJiraReader(respond(500)), { issueKey: 'PAY-9' }),
    ).rejects.toThrow('jira-issue-read failed with 500');
  });
});
