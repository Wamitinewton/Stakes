import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, fixture, forgeApiMock } from '../fakes/jira';

vi.mock('@forge/api', () => forgeApiMock());

const { makeJiraReader, parseSlaBreach, pickAccountId, storyPointFieldIds } =
  await import('../../src/adapters/jira');

const SITE = 'https://example.atlassian.net';
const forbidden = { status: 403, body: fixture('forbidden') };

describe('issue', () => {
  it('reads the fields the score and panel need, including story points', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/field': { status: 200, body: fixture('fields') },
      'GET /rest/api/3/issue/PAY-142': { status: 200, body: fixture('issue.happy') },
    });
    const issue = await makeJiraReader(SITE, http).issue('PAY-142');
    expect(issue).toEqual({
      key: 'PAY-142',
      id: '10042',
      projectKey: 'PAY',
      summary: 'CSV export times out above 10k rows',
      status: 'To Do',
      statusCategory: 'new',
      priority: 'Low',
      assigneeAccountId: 'acc-dev-1',
      fixVersions: ['2026.12'],
      components: ['Exports'],
      storyPoints: 5,
      labels: ['stakes-demo'],
      updated: '2026-11-19T15:20:00.000+0000',
      url: 'https://example.atlassian.net/browse/PAY-142',
    });
    expect(calls[1]!.path).toContain('customfield_10016%2Ccustomfield_10028');
  });

  it('fills defaults for an issue with sparse fields', async () => {
    const { http } = fakeHttp({
      'GET /rest/api/3/issue/PAY-150': { status: 200, body: fixture('issue.empty') },
    });
    expect(await makeJiraReader(SITE, http).issue('PAY-150')).toMatchObject({
      projectKey: 'PAY',
      priority: '',
      statusCategory: 'unknown',
      assigneeAccountId: null,
      storyPoints: null,
      fixVersions: [],
    });
  });

  it('returns null for an issue the caller cannot see, and throws on a server error', async () => {
    expect(
      await makeJiraReader(SITE, fakeHttp({ 'GET /rest/api/3/issue': forbidden }).http).issue(
        'PAY-1',
      ),
    ).toBeNull();
    const broken = fakeHttp({ 'GET /rest/api/3/issue': { status: 500 } }).http;
    await expect(makeJiraReader(SITE, broken).issue('PAY-1')).rejects.toThrow(
      'jira-issue-read failed with HTTP 500',
    );
  });
});

describe('linkedRequests', () => {
  it('keeps open service-desk requests, flags escalations and prefers demo dates', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { http, calls } = fakeHttp({
      'POST /rest/api/3/search/jql': { status: 200, body: fixture('search.linked.happy') },
      'GET /rest/servicedeskapi/request/HELP-2/sla': { status: 200, body: fixture('sla.happy') },
    });
    const result = await makeJiraReader(SITE, http).linkedRequests('PAY-142');
    expect(calls[0]!.body).toMatchObject({
      jql: 'issue in linkedIssues("PAY-142")',
      properties: ['stakes.demo'],
    });
    expect(result).toEqual({
      hidden: 0,
      requests: [
        {
          key: 'HELP-1',
          summary: 'Export over 10k rows fails',
          priority: 'High',
          createdAt: '2026-11-05T09:00:00.000Z',
          slaBreachAt: null,
          escalated: false,
          assigneeAccountId: 'acc-agent-1',
          url: 'https://example.atlassian.net/browse/HELP-1',
        },
        {
          key: 'HELP-2',
          summary: 'Cannot export claims ledger',
          priority: 'Medium',
          createdAt: '2026-11-10T09:00:00.000+0000',
          slaBreachAt: '2025-12-16T00:00:00.000Z',
          escalated: true,
          assigneeAccountId: null,
          url: 'https://example.atlassian.net/browse/HELP-2',
        },
      ],
    });
    // Demo requests never ask for a live SLA.
    expect(calls.some((c) => c.path.includes('HELP-1/sla'))).toBe(false);
  });

  it('returns nothing when no requests are linked', async () => {
    const { http } = fakeHttp({
      'POST /rest/api/3/search/jql': { status: 200, body: fixture('search.linked.empty') },
    });
    expect(await makeJiraReader(SITE, http).linkedRequests('PAY-150')).toEqual({
      requests: [],
      hidden: 0,
    });
  });

  it('skips and counts a request whose SLA the caller cannot see, rather than throwing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { http } = fakeHttp({
      'POST /rest/api/3/search/jql': { status: 200, body: fixture('search.linked.happy') },
      'GET /rest/servicedeskapi/request/HELP-2/sla': forbidden,
    });
    const result = await makeJiraReader(SITE, http).linkedRequests('PAY-142');
    expect(result.hidden).toBe(1);
    expect(result.requests.map((r) => r.key)).toEqual(['HELP-1', 'HELP-2']);
    expect(result.requests[1]!.slaBreachAt).toBeNull();
  });

  it('throws when the search itself fails', async () => {
    const { http } = fakeHttp({ 'POST /rest/api/3/search/jql': { status: 400 } });
    await expect(makeJiraReader(SITE, http).linkedRequests('PAY-1')).rejects.toThrow(
      'jira-linked-requests',
    );
  });
});

describe('bridgeCrm', () => {
  it('parses the bridge property with the shared schema', async () => {
    const { http } = fakeHttp({
      'GET /rest/api/3/issue/PAY-142/properties/stakesBridge.crm': {
        status: 200,
        body: fixture('property.bridge.happy'),
      },
    });
    const crm = await makeJiraReader(SITE, http).bridgeCrm('PAY-142');
    expect(crm?.deals[0]).toMatchObject({ id: 'HS-901', probability: 0.8 });
  });

  it('returns null when the property is absent, forbidden or invalid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reader = (reply: { status: number; body?: unknown }) =>
      makeJiraReader(SITE, fakeHttp({ 'GET /rest/api/3/issue/PAY-1/properties': reply }).http);
    expect(await reader({ status: 404 }).bridgeCrm('PAY-1')).toBeNull();
    expect(await reader(forbidden).bridgeCrm('PAY-1')).toBeNull();
    expect(
      await reader({ status: 200, body: fixture('property.bridge.invalid') }).bridgeCrm('PAY-1'),
    ).toBeNull();
  });
});

describe('permissions and lookups', () => {
  it('lists only unreleased project versions', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/project/PAY/versions': {
        status: 200,
        body: [
          { id: '10001', name: '2026.12', released: false },
          { id: '10000', name: '2026.11', released: true },
        ],
      },
    });
    expect(await makeJiraReader(SITE, http).unreleasedVersions('PAY')).toEqual([
      { id: '10001', name: '2026.12' },
    ]);
    expect(calls[0]?.path).toBe('/rest/api/3/project/PAY/versions');
  });

  it('checks whether the caller can view an issue', async () => {
    const ok = fakeHttp({ 'GET /rest/api/3/issue/PAY-1': { status: 200, body: {} } }).http;
    expect(await makeJiraReader(SITE, ok).canView('PAY-1')).toBe(true);
    expect(
      await makeJiraReader(SITE, fakeHttp({ 'GET /rest/api/3/issue': forbidden }).http).canView(
        'PAY-1',
      ),
    ).toBe(false);
  });

  it('resolves an email to an account id, escaping the query', async () => {
    const { http, calls } = fakeHttp({
      'GET /rest/api/3/user/search': { status: 200, body: fixture('users') },
    });
    expect(await makeJiraReader(SITE, http).accountIdForEmail('Owner@Example.com')).toBe(
      'acc-owner-1',
    );
    expect(calls[0]!.path).toContain('query=Owner%40Example.com');
  });

  it('checks Jira admin permission', async () => {
    const yes = fakeHttp({
      'GET /rest/api/3/mypermissions': { status: 200, body: fixture('mypermissions') },
    }).http;
    expect(await makeJiraReader(SITE, yes).isAdmin()).toBe(true);
    expect(await makeJiraReader(SITE, fakeHttp({}).http).isAdmin()).toBe(false);
  });

  it('lists priorities and projects', async () => {
    const { http } = fakeHttp({
      'GET /rest/api/3/priority/search': { status: 200, body: fixture('priorities') },
      'GET /rest/api/3/project/search': { status: 200, body: fixture('projects') },
    });
    const reader = makeJiraReader(SITE, http);
    expect(await reader.priorities()).toEqual(['Highest', 'High', 'Medium', 'Low', 'Lowest']);
    expect(await reader.projects()).toEqual([
      { key: 'HELP', name: 'Orbit Pay Help', type: 'service_desk' },
      { key: 'PAY', name: 'Orbit Pay', type: 'software' },
    ]);
  });
});

describe('parsers', () => {
  it('finds story point fields by name', () => {
    expect(storyPointFieldIds(fixture('fields'))).toEqual([
      'customfield_10016',
      'customfield_10028',
    ]);
    expect(storyPointFieldIds(null)).toEqual([]);
  });

  it('takes the nearest running SLA breach', () => {
    expect(parseSlaBreach(fixture('sla.happy'))).toBe('2025-12-16T00:00:00.000Z');
    expect(parseSlaBreach({ values: [{ completedCycles: [] }] })).toBeNull();
    expect(parseSlaBreach(null)).toBeNull();
  });

  it('accepts a single match when emails are hidden, and refuses to guess between several', () => {
    expect(pickAccountId('x@example.com', [{ accountId: 'a1', accountType: 'atlassian' }])).toBe(
      'a1',
    );
    expect(
      pickAccountId('x@example.com', [
        { accountId: 'a1', accountType: 'atlassian' },
        { accountId: 'a2', accountType: 'atlassian' },
      ]),
    ).toBeNull();
    expect(pickAccountId('x@example.com', [{ accountId: 'bot', accountType: 'app' }])).toBeNull();
  });
});
