import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asUser: vi.fn() } }));

const { makeGraphClient, makeGraphReader, appContextGraphReader } =
  await import('../../src/adapters/graph.js');
const { Q1_DEALS, Q3_CONVERSATIONS, Q4_GOALS, Q5_TEAM } =
  await import('../../src/adapters/graph.queries.js');

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/graph/${name}.json`, import.meta.url), 'utf8'));

const issue = { key: 'PAY-142', id: '10042' };

function readerReplying(name: string) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const request = vi.fn().mockResolvedValue({ status: 200, json: async () => fixture(name) });
  return { reader: makeGraphReader(makeGraphClient(request), 'cloud-1'), request };
}

describe('graph reader', () => {
  it.each([Q1_DEALS, Q3_CONVERSATIONS, Q4_GOALS, Q5_TEAM])(
    'names $operationName after its question',
    (q) => {
      expect(q.operationName).toMatch(/^stakes_q[1-5]_[a-z]+$/);
      expect(q.query).toContain(`query ${q.operationName}(`);
    },
  );

  it('reads deals for an issue through the persisted query', async () => {
    const { reader, request } = readerReplying('q1.happy');
    expect(await reader.dealsForIssue(issue)).toEqual({
      ok: true,
      data: [
        {
          id: 'DEAL-031',
          name: 'Example Freight — Enterprise expansion',
          amountUsd: 220000,
          stage: 'Negotiation',
          closed: false,
          closeDate: '2026-12-15',
          accountName: 'Example Freight',
          url: 'https://example.test/deal/DEAL-031',
        },
      ],
    });
    expect(request).toHaveBeenCalledWith(
      Q1_DEALS.query,
      { queryKey: 'stakes_q1_deals', queryParams: { issueKey: 'PAY-142' } },
      'stakes_q1_deals',
    );
  });

  it('treats an issue with no deals as a real empty answer', async () => {
    expect(await readerReplying('q1.empty').reader.dealsForIssue(issue)).toEqual({
      ok: true,
      data: [],
    });
  });

  it('marks an unregistered persisted query as degraded', async () => {
    expect(await readerReplying('q1.error').reader.dealsForIssue(issue)).toMatchObject({
      ok: false,
      reason: 'partial-errors',
    });
  });

  it('reads conversations, passing the window', async () => {
    const { reader, request } = readerReplying('q3.happy');
    const result = await reader.conversationsForIssue(issue, 30);
    expect(result.ok && result.data.map((c) => c.at)).toEqual([
      '2026-11-19T08:00:00Z',
      '2026-11-08T08:00:00Z',
    ]);
    expect(request.mock.calls[0]![1]).toEqual({
      queryKey: 'stakes_q3_conversations',
      queryParams: { issueKey: 'PAY-142', sinceDays: 30 },
    });
    expect(await readerReplying('q3.empty').reader.conversationsForIssue(issue, 30)).toEqual({
      ok: true,
      data: [],
    });
    expect(await readerReplying('q3.error').reader.conversationsForIssue(issue, 30)).toMatchObject({
      ok: false,
    });
  });

  it('reads goals by issue ARI and maps their state', async () => {
    const { reader, request } = readerReplying('q4.happy');
    const result = await reader.goalsForIssue(issue);
    expect(request.mock.calls[0]![1]).toEqual({ id: 'ari:cloud:jira:cloud-1:issue/10042' });
    expect(result.ok && result.data.map((g) => [g.name, g.status])).toEqual([
      ['Reduce enterprise churn', 'on-track'],
      ['Faster exports', 'at-risk'],
    ]);
    expect(await readerReplying('q4.empty').reader.goalsForIssue(issue)).toEqual({
      ok: true,
      data: [],
    });
    expect(await readerReplying('q4.error').reader.goalsForIssue(issue)).toMatchObject({
      ok: false,
      reason: 'partial-errors',
    });
  });

  it('reads the first team, or null', async () => {
    expect(await readerReplying('q5.happy').reader.teamForIssue(issue)).toEqual({
      ok: true,
      data: { id: 'team-1', name: 'Payments' },
    });
    expect(await readerReplying('q5.empty').reader.teamForIssue(issue)).toEqual({
      ok: true,
      data: null,
    });
    expect(await readerReplying('q5.error').reader.teamForIssue(issue)).toMatchObject({
      ok: false,
    });
  });

  it('answers escalations with an empty list and no graph call', async () => {
    const { reader, request } = readerReplying('q1.happy');
    expect(await reader.escalationsForIssue(issue)).toEqual({ ok: true, data: [] });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses every read in app context', () => {
    const reader = appContextGraphReader();
    expect(() => reader.dealsForIssue(issue)).toThrow('Teamwork Graph is user-only');
    expect(() => reader.goalsForIssue(issue)).toThrow('Teamwork Graph is user-only');
    expect(() => reader.conversationsForIssue(issue, 30)).toThrow('Teamwork Graph is user-only');
  });
});
