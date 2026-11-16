import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, forgeApiMock } from '../fakes/jira.js';

vi.mock('@forge/api', () => forgeApiMock());

const { makeJiraWriter, toIssueFields } = await import('../../src/adapters/jiraWriter.js');

describe('jira writer', () => {
  it('reads a project with its issue types, or null when it is missing', async () => {
    const { http } = fakeHttp({
      'GET /rest/api/3/project/PAY': {
        status: 200,
        body: { id: '10000', key: 'PAY', projectTypeKey: 'software' },
      },
      'GET /rest/api/3/issue/createmeta/PAY/issuetypes': {
        status: 200,
        body: {
          issueTypes: [
            { id: '1', name: 'Story' },
            { id: '2', name: 'Bug' },
          ],
        },
      },
    });
    const writer = makeJiraWriter(http);
    expect(await writer.project('PAY')).toEqual({
      id: '10000',
      key: 'PAY',
      type: 'software',
      issueTypes: [
        { id: '1', name: 'Story' },
        { id: '2', name: 'Bug' },
      ],
    });
    expect(await writer.project('NOPE')).toBeNull();
  });

  it('finds the service desk and its request types by project key', async () => {
    const { http } = fakeHttp({
      'GET /rest/servicedeskapi/servicedesk?': {
        status: 200,
        body: { values: [{ id: 3, projectKey: 'HELP' }] },
      },
      'GET /rest/servicedeskapi/servicedesk/3/requesttype': {
        status: 200,
        body: { values: [{ id: '11', name: 'Get IT help' }] },
      },
    });
    const writer = makeJiraWriter(http);
    expect(await writer.serviceDesk('HELP')).toEqual({
      id: '3',
      requestTypes: [{ id: '11', name: 'Get IT help' }],
    });
    expect(await writer.serviceDesk('PAY')).toBeNull();
  });

  it('creates issues in bulk calls of at most 50 and returns their keys in order', async () => {
    let n = 0;
    const { http, calls } = fakeHttp({
      'POST /rest/api/3/issue/bulk': (body) => ({
        status: 201,
        body: {
          issues: (body as { issueUpdates: unknown[] }).issueUpdates.map(() => ({
            key: `PAY-${++n}`,
          })),
          errors: [],
        },
      }),
    });
    const issue = { projectId: '1', issueTypeId: '2', summary: 's' };
    const keys = await makeJiraWriter(http).createIssues(Array.from({ length: 60 }, () => issue));
    expect(calls).toHaveLength(2);
    expect(keys[0]).toBe('PAY-1');
    expect(keys[59]).toBe('PAY-60');
  });

  it('reports which issues in a bulk create Jira refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { http } = fakeHttp({
      'POST /rest/api/3/issue/bulk': {
        status: 201,
        body: {
          issues: [{ key: 'PAY-1' }, { key: 'PAY-2' }],
          errors: [{ failedElementNumber: 1, status: 400 }],
        },
      },
    });
    const issue = { projectId: '1', issueTypeId: '2', summary: 's' };
    expect(await makeJiraWriter(http).createIssues([issue, issue, issue])).toEqual([
      'PAY-1',
      null,
      'PAY-2',
    ]);
  });

  it('throws when the bulk create call itself fails', async () => {
    const { http } = fakeHttp({ 'POST /rest/api/3/issue/bulk': { status: 500 } });
    await expect(
      makeJiraWriter(http).createIssues([{ projectId: '1', issueTypeId: '2', summary: 's' }]),
    ).rejects.toThrow('jira-bulk-create');
  });

  it('searches every page of keys', async () => {
    let page = 0;
    const { http, calls } = fakeHttp({
      'POST /rest/api/3/search/jql': () =>
        page++ === 0
          ? { status: 200, body: { issues: [{ key: 'PAY-1' }], nextPageToken: 't2' } }
          : { status: 200, body: { issues: [{ key: 'HELP-1' }] } },
    });
    expect(await makeJiraWriter(http).searchKeys('labels = stakes-demo')).toEqual([
      'PAY-1',
      'HELP-1',
    ]);
    expect(calls[1]!.body).toMatchObject({ nextPageToken: 't2' });
  });

  it('builds issue fields with priority, labels, points, version and an ADF description', () => {
    expect(
      toIssueFields({
        projectId: '1',
        issueTypeId: '2',
        summary: 'S',
        priority: 'Low',
        labels: ['stakes-demo'],
        storyPoints: { fieldId: 'customfield_10016', value: 5 },
        fixVersionIds: ['30'],
        description: 'Text',
      }),
    ).toEqual({
      project: { id: '1' },
      issuetype: { id: '2' },
      summary: 'S',
      priority: { name: 'Low' },
      labels: ['stakes-demo'],
      fixVersions: [{ id: '30' }],
      customfield_10016: 5,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
      },
    });
  });

  it('creates a request, updates it, links it and sets a property', async () => {
    const { http, calls } = fakeHttp({
      'POST /rest/servicedeskapi/request': { status: 201, body: { issueKey: 'HELP-1' } },
      'PUT /rest/api/3/issue/HELP-1?': { status: 204 },
      'PUT /rest/api/3/issue/HELP-1/properties/stakes.demo': { status: 200 },
      'POST /rest/api/3/issueLink': { status: 201 },
    });
    const writer = makeJiraWriter(http);
    const key = await writer.createRequest({
      serviceDeskId: '3',
      requestTypeId: '11',
      summary: 's',
      description: 'd',
    });
    await writer.updateIssue(key, { priority: 'High', addLabels: ['stakes-demo', 'escalation'] });
    await writer.setProperty(key, 'stakes.demo', { createdAt: 'x' });
    await writer.linkIssues('HELP-1', 'PAY-142');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /rest/servicedeskapi/request',
      'PUT /rest/api/3/issue/HELP-1?notifyUsers=false',
      'PUT /rest/api/3/issue/HELP-1/properties/stakes.demo',
      'POST /rest/api/3/issueLink',
    ]);
    expect(calls[1]!.body).toEqual({
      fields: { priority: { name: 'High' } },
      update: { labels: [{ add: 'stakes-demo' }, { add: 'escalation' }] },
    });
  });

  it('posts an Atlassian Document Format comment', async () => {
    const { http, calls } = fakeHttp({
      'POST /rest/api/3/issue/PAY-142/comment': { status: 201, body: { id: '9001' } },
    });
    const body = {
      type: 'doc' as const,
      version: 1 as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Approved via Stakes' }] }],
    };
    await makeJiraWriter(http).addComment('PAY-142', body);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/issue/PAY-142/comment',
        body: { body },
      },
    ]);
  });

  it('treats deleting something already gone as done', async () => {
    const { http } = fakeHttp({
      'DELETE /rest/api/3/issue/PAY-1?': { status: 204 },
      'DELETE /rest/api/3/version/9': { status: 404 },
      'DELETE /rest/agile/1.0/sprint/4': { status: 404 },
    });
    const writer = makeJiraWriter(http);
    expect(await writer.deleteIssue('PAY-1')).toBe('deleted');
    expect(await writer.deleteIssue('PAY-2')).toBe('missing');
    await expect(writer.deleteVersion('9')).resolves.toBeUndefined();
    await expect(writer.deleteSprint(4)).resolves.toBeUndefined();
  });

  it('creates and starts an active sprint, keeping it as future if the board refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { http, calls } = fakeHttp({
      'POST /rest/agile/1.0/sprint': { status: 201, body: { id: 7 } },
      'POST /rest/agile/1.0/sprint/7': { status: 400 },
      'POST /rest/agile/1.0/sprint/7/issue': { status: 204 },
      'POST /rest/api/3/version': { status: 201, body: { id: '30' } },
      'GET /rest/agile/1.0/board': { status: 200, body: { values: [{ id: 5 }] } },
    });
    const writer = makeJiraWriter(http);
    expect(await writer.scrumBoard('PAY')).toBe(5);
    expect(await writer.createSprint(5, 'Sprint 1', 'a', 'b', true)).toBe(7);
    await writer.moveToSprint(7, ['PAY-1']);
    expect(await writer.createVersion('10000', '2026.12', '2026-12-15')).toBe('30');
    expect(calls.find((c) => c.path === '/rest/api/3/version')!.body).toMatchObject({
      projectId: 10000,
    });
  });
});
