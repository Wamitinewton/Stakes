import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, fixture, forgeApiMock } from '../fakes/jira.js';

vi.mock('@forge/api', () => forgeApiMock());
const { makeSprintAdapter, parseBoards, parseSprints } =
  await import('../../src/adapters/sprint.js');

const issue = (key: string, points: number | null, category = 'new') => ({
  id: key,
  key,
  fields: {
    summary: key,
    project: { key: 'PAY' },
    status: { name: category, statusCategory: { key: category } },
    customfield_10016: points,
  },
});

describe('sprint adapter', () => {
  it('parses boards and sprints and ignores unknown sprint states', () => {
    expect(parseBoards({ values: [{ id: 7, name: 'PAY board' }, { name: 'bad' }] })).toEqual([
      { id: 7, name: 'PAY board' },
    ]);
    expect(
      parseSprints({
        values: [
          { id: 11, name: 'Sprint 24', state: 'future' },
          { id: 10, name: 'Sprint 23', state: 'other', completeDate: '2026-11-01' },
        ],
      }),
    ).toEqual([
      { id: 11, name: 'Sprint 24', state: 'future', completeDate: null },
      { id: 10, name: 'Sprint 23', state: 'unknown', completeDate: '2026-11-01' },
    ]);
  });

  it('lists boards with their future sprints', async () => {
    const { http } = fakeHttp({
      'GET /rest/agile/1.0/board?': {
        status: 200,
        body: { values: [{ id: 7, name: 'PAY board' }], isLast: true },
      },
      'GET /rest/agile/1.0/board/7/sprint': {
        status: 200,
        body: { values: [{ id: 11, name: 'Sprint 24', state: 'future' }], isLast: true },
      },
    });
    expect(await makeSprintAdapter('https://example.atlassian.net', http).boards('PAY')).toEqual([
      { id: 7, name: 'PAY board', futureSprints: [{ id: 11, name: 'Sprint 24' }] },
    ]);
  });

  it('reads open issues not assigned to a sprint and follows search pages', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/field': { status: 200, body: fixture('fields') },
      'POST /rest/api/3/search/jql': (body) => {
        const request = body as { nextPageToken?: string };
        return {
          status: 200,
          body: request.nextPageToken
            ? { issues: [issue('PAY-2', 3)] }
            : { issues: [issue('PAY-1', 2)], nextPageToken: 'next' },
        };
      },
    });
    const issues = await makeSprintAdapter('https://example.atlassian.net', http).unassignedIssues([
      'PAY',
    ]);
    expect(issues.map((row) => row.key)).toEqual(['PAY-1', 'PAY-2']);
    expect(calls[1]!.body).toMatchObject({
      jql: 'project in ("PAY") AND sprint IS EMPTY AND statusCategory != Done ORDER BY key ASC',
    });
    expect(calls[2]!.body).toMatchObject({ nextPageToken: 'next' });
  });

  it('averages completed points from the latest three closed sprints', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/field': { status: 200, body: fixture('fields') },
      'GET /rest/agile/1.0/board/7/sprint': {
        status: 200,
        body: {
          values: [
            { id: 1, name: 'Old', state: 'closed', completeDate: '2026-10-01' },
            { id: 4, name: 'Newest', state: 'closed', completeDate: '2026-11-04' },
            { id: 3, name: 'Middle', state: 'closed', completeDate: '2026-11-03' },
            { id: 2, name: 'Older', state: 'closed', completeDate: '2026-11-02' },
          ],
          isLast: true,
        },
      },
      'GET /rest/agile/1.0/sprint/4/issue': {
        status: 200,
        body: { issues: [issue('PAY-4', 5, 'done'), issue('PAY-44', 20)], isLast: true },
      },
      'GET /rest/agile/1.0/sprint/3/issue': {
        status: 200,
        body: { issues: [issue('PAY-3', 3, 'done')], isLast: true },
      },
      'GET /rest/agile/1.0/sprint/2/issue': {
        status: 200,
        body: { issues: [issue('PAY-2', 2.5, 'done')], isLast: true },
      },
    });
    expect(
      await makeSprintAdapter('https://example.atlassian.net', http).completedPoints(7),
    ).toEqual([5, 3, 2.5]);
    expect(calls.some((call) => call.path.includes('/sprint/1/issue'))).toBe(false);
  });

  it('moves issues in batches of fifty', async () => {
    const { http, calls } = fakeHttp({
      'POST /rest/agile/1.0/sprint/11/issue': { status: 204 },
    });
    const keys = Array.from({ length: 51 }, (_, index) => `PAY-${index + 1}`);
    await makeSprintAdapter('https://example.atlassian.net', http).moveIssues(11, keys);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toEqual({ issues: keys.slice(0, 50) });
    expect(calls[1]!.body).toEqual({ issues: keys.slice(50) });
  });
});
