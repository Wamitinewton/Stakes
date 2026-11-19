import api, { route } from '@forge/api';
import {
  BRIDGE_CRM_PROPERTY_KEY,
  BridgeCrmProperty,
  type IssueKey,
  type ReleaseVersion,
} from '@stakes/contracts';

// ---------------------------------------------------------------------------------
// HTTP. Every call in this file runs as the person using Stakes, so a reader only
// ever sees issues, requests and properties their own Jira permissions allow.
// ---------------------------------------------------------------------------------

export type Route = ReturnType<typeof route>;

export interface JiraResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type JiraHttp = (
  path: Route,
  init?: { method?: string; body?: unknown },
) => Promise<JiraResponse>;

export const asUserHttp: JiraHttp = (path, init) =>
  api.asUser().requestJira(path, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

// Triggers and scheduled jobs have no user. They may read Jira as the app, but never
// write to it: every visible change is made by the person who approved it.
export const asAppHttp: JiraHttp = (path) =>
  api.asApp().requestJira(path, { headers: { Accept: 'application/json' } });

export class JiraError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with HTTP ${status}`);
    this.name = 'JiraError';
  }
}

export async function expectOk(operation: string, res: JiraResponse): Promise<unknown> {
  if (!res.ok) throw new JiraError(operation, res.status);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ---------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------

export interface IssueDetails {
  key: IssueKey;
  id: string;
  projectKey: string;
  summary: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  priority: string;
  assigneeAccountId: string | null;
  fixVersions: string[];
  components: string[];
  storyPoints: number | null;
  labels: string[];
  updated: string;
  url: string;
}

export interface LinkedRequest {
  key: IssueKey;
  summary: string;
  priority: string;
  createdAt: string;
  slaBreachAt: string | null;
  escalated: boolean;
  assigneeAccountId: string | null;
  url: string;
}

export interface LinkedRequests {
  requests: LinkedRequest[];
  // Linked requests whose details Jira refused to show this viewer.
  hidden: number;
}

// Seeded requests carry the dates of the demo story in this property, because Jira
// stamps `created` itself and has no way to backdate an issue.
export const DEMO_REQUEST_PROPERTY = 'stakes.demo';
interface DemoRequestDates {
  createdAt: string;
  slaBreachAt: string | null;
}

export interface JiraReader {
  // null when the issue doesn't exist or the caller can't see it; Jira answers 404 for both.
  issue(issueKey: IssueKey): Promise<IssueDetails | null>;
  openIssues(projectKey: string): Promise<IssueDetails[]>;
  unreleasedVersions(projectKey: string): Promise<ReleaseVersion[]>;
  linkedRequests(issueKey: IssueKey): Promise<LinkedRequests>;
  issuesInVersion(versionId: string): Promise<IssueKey[]>;
  bridgeCrm(issueKey: IssueKey): Promise<BridgeCrmProperty | null>;
  canView(issueKey: IssueKey): Promise<boolean>;
  accountIdForEmail(email: string): Promise<string | null>;
  isAdmin(): Promise<boolean>;
  priorities(): Promise<string[]>;
  projects(): Promise<Array<{ key: string; name: string; type: string }>>;
}

// ---------------------------------------------------------------------------------
// Parsers, exported so the contract tests can run them against recorded responses.
// ---------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const names = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(obj(x).name)).filter((n) => n !== '') : [];

const STATUS_CATEGORIES = new Set(['new', 'indeterminate', 'done']);

// Story points live in a custom field whose id differs per site and per project style.
const STORY_POINT_FIELD_NAMES = ['story point estimate', 'story points'];

export function storyPointFieldIds(fieldList: unknown): string[] {
  if (!Array.isArray(fieldList)) return [];
  return fieldList
    .map(obj)
    .filter((f) => STORY_POINT_FIELD_NAMES.includes(str(f.name).toLowerCase()))
    .map((f) => str(f.id))
    .filter((id) => id !== '');
}

export function parseIssue(
  issueKey: IssueKey,
  body: unknown,
  siteUrl: string,
  pointFields: string[],
): IssueDetails {
  const b = obj(body);
  const f = obj(b.fields);
  const category = str(obj(obj(f.status).statusCategory).key);
  const points = pointFields.map((id) => f[id]).find((v) => typeof v === 'number');
  return {
    key: issueKey,
    id: str(b.id),
    projectKey: str(obj(f.project).key) || issueKey.slice(0, issueKey.lastIndexOf('-')),
    summary: str(f.summary),
    status: str(obj(f.status).name),
    statusCategory: STATUS_CATEGORIES.has(category)
      ? (category as IssueDetails['statusCategory'])
      : 'unknown',
    priority: str(obj(f.priority).name),
    assigneeAccountId: strOrNull(obj(f.assignee).accountId),
    fixVersions: names(f.fixVersions),
    components: names(f.components),
    storyPoints: typeof points === 'number' ? points : null,
    labels: Array.isArray(f.labels)
      ? f.labels.filter((l): l is string => typeof l === 'string')
      : [],
    updated: str(f.updated),
    url: `${siteUrl}/browse/${issueKey}`,
  };
}

const ESCALATION_LABELS = new Set(['escalation', 'escalated']);

export interface ParsedRequest extends LinkedRequest {
  // Demo requests already carry their SLA date, so their live SLA is not read.
  hasDemoDates: boolean;
}

// Requests are the linked issues in service projects that are not resolved yet; links
// to other software issues are not support pressure.
export function parseLinkedRequests(searchBody: unknown, siteUrl: string): ParsedRequest[] {
  const issues = obj(searchBody).issues;
  if (!Array.isArray(issues)) return [];
  return issues.map(obj).flatMap((issue): ParsedRequest[] => {
    const f = obj(issue.fields);
    if (str(obj(f.project).projectTypeKey) !== 'service_desk') return [];
    if (str(obj(obj(f.status).statusCategory).key) === 'done') return [];
    const key = str(issue.key);
    const labels = Array.isArray(f.labels) ? f.labels.map(str) : [];
    const demo = obj(obj(issue.properties)[DEMO_REQUEST_PROPERTY]) as Partial<DemoRequestDates>;
    return [
      {
        key,
        summary: str(f.summary),
        priority: str(obj(f.priority).name) || 'Medium',
        createdAt: strOrNull(demo.createdAt) ?? str(f.created),
        slaBreachAt: demo.createdAt ? (demo.slaBreachAt ?? null) : null,
        escalated: labels.some((l) => ESCALATION_LABELS.has(l.toLowerCase())),
        assigneeAccountId: strOrNull(obj(f.assignee).accountId),
        url: `${siteUrl}/browse/${key}`,
        hasDemoDates: Boolean(demo.createdAt),
      },
    ];
  });
}

// The nearest breach among the request's running SLA cycles; a paused or breached
// cycle has no future breach time to count down to.
export function parseSlaBreach(slaBody: unknown): string | null {
  const values = obj(slaBody).values;
  if (!Array.isArray(values)) return null;
  const times = values
    .map((v) => obj(obj(obj(v).ongoingCycle).breachTime).epochMillis)
    .filter((t): t is number => typeof t === 'number');
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

export function pickAccountId(email: string, usersBody: unknown): string | null {
  if (!Array.isArray(usersBody)) return null;
  const users = usersBody.map(obj).filter((u) => str(u.accountType) !== 'app');
  const exact = users.find((u) => str(u.emailAddress).toLowerCase() === email.toLowerCase());
  if (exact) return str(exact.accountId) || null;
  // Most sites hide email addresses; a single match for the query is the same person.
  return users.length === 1 ? str(users[0]!.accountId) || null : null;
}

// ---------------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------------

const REQUEST_FIELDS = [
  'summary',
  'priority',
  'created',
  'labels',
  'assignee',
  'status',
  'project',
];

export function makeJiraReader(siteUrl: string, http: JiraHttp = asUserHttp): JiraReader {
  let pointFields: Promise<string[]> | null = null;
  const storyPointFields = () =>
    (pointFields ??= http(route`/rest/api/3/field`)
      .then((r) => (r.ok ? r.json() : []))
      .then(storyPointFieldIds)
      .catch(() => []));

  return {
    async issue(issueKey) {
      const fields = await storyPointFields();
      const wanted = [
        'summary',
        'status',
        'priority',
        'assignee',
        'fixVersions',
        'components',
        'labels',
        'updated',
        'project',
        ...fields,
      ].join(',');
      const res = await http(route`/rest/api/3/issue/${issueKey}?fields=${wanted}`);
      if (res.status === 404 || res.status === 403) return null;
      return parseIssue(issueKey, await expectOk('jira-issue-read', res), siteUrl, fields);
    },

    async openIssues(projectKey) {
      const pointFields = await storyPointFields();
      const fields = [
        'summary',
        'status',
        'priority',
        'assignee',
        'fixVersions',
        'components',
        'labels',
        'updated',
        'project',
        ...pointFields,
      ];
      const issues: IssueDetails[] = [];
      let nextPageToken: string | undefined;
      do {
        const res = await http(route`/rest/api/3/search/jql`, {
          method: 'POST',
          body: {
            jql: `project = "${projectKey}" AND statusCategory != Done ORDER BY key ASC`,
            fields,
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        const body = obj(await expectOk('jira-open-issues', res));
        const page = Array.isArray(body.issues) ? body.issues : [];
        issues.push(
          ...page.map((issue) => parseIssue(str(obj(issue).key), issue, siteUrl, pointFields)),
        );
        nextPageToken = strOrNull(body.nextPageToken) ?? undefined;
      } while (nextPageToken);
      return issues;
    },

    async unreleasedVersions(projectKey) {
      const res = await http(route`/rest/api/3/project/${projectKey}/versions`);
      const body = await expectOk('jira-project-versions', res);
      return (Array.isArray(body) ? body : [])
        .map(obj)
        .filter((version) => version.released !== true)
        .map((version) => ({ id: str(version.id), name: str(version.name) }))
        .filter((version) => version.id !== '' && version.name !== '');
    },

    async linkedRequests(issueKey) {
      const res = await http(route`/rest/api/3/search/jql`, {
        method: 'POST',
        body: {
          jql: `issue in linkedIssues("${issueKey}")`,
          fields: REQUEST_FIELDS,
          properties: [DEMO_REQUEST_PROPERTY],
          maxResults: 100,
        },
      });
      const found = parseLinkedRequests(await expectOk('jira-linked-requests', res), siteUrl);
      let hidden = 0;
      const requests = await Promise.all(
        found.map(async ({ hasDemoDates, ...request }) => {
          if (hasDemoDates) return request;
          const sla = await http(route`/rest/servicedeskapi/request/${request.key}/sla`);
          if (sla.status === 403 || sla.status === 404) {
            hidden++;
            return request;
          }
          if (!sla.ok) return request;
          return { ...request, slaBreachAt: parseSlaBreach(await sla.json()) };
        }),
      );
      if (hidden > 0) console.log('linked request details hidden', { issueKey, hidden });
      return { requests, hidden };
    },

    // Keys only: callers read each issue's details themselves when they need them.
    async issuesInVersion(versionId) {
      if (!/^\d+$/.test(versionId)) return [];
      const keys: IssueKey[] = [];
      let nextPageToken: string | undefined;
      do {
        const res = await http(route`/rest/api/3/search/jql`, {
          method: 'POST',
          body: {
            jql: `fixVersion = ${versionId} ORDER BY key ASC`,
            fields: ['summary'],
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        const body = obj(await expectOk('jira-version-issues', res));
        const page = Array.isArray(body.issues) ? body.issues : [];
        keys.push(...page.map((issue) => str(obj(issue).key)).filter((k) => k !== ''));
        nextPageToken = strOrNull(body.nextPageToken) ?? undefined;
      } while (nextPageToken);
      return keys;
    },

    async bridgeCrm(issueKey) {
      const res = await http(
        route`/rest/api/3/issue/${issueKey}/properties/${BRIDGE_CRM_PROPERTY_KEY}`,
      );
      if (!res.ok) return null;
      const parsed = BridgeCrmProperty.safeParse(obj(await res.json().catch(() => null)).value);
      if (!parsed.success) {
        console.warn('bridge crm property invalid', { issueKey });
        return null;
      }
      return parsed.data;
    },

    async canView(issueKey) {
      const res = await http(route`/rest/api/3/issue/${issueKey}?fields=summary`);
      return res.ok;
    },

    async accountIdForEmail(email) {
      const res = await http(route`/rest/api/3/user/search?query=${email}&maxResults=10`);
      if (!res.ok) return null;
      return pickAccountId(email, await res.json());
    },

    async isAdmin() {
      const res = await http(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
      if (!res.ok) return false;
      return obj(obj(obj(await res.json()).permissions).ADMINISTER).havePermission === true;
    },

    async priorities() {
      const res = await http(route`/rest/api/3/priority/search?maxResults=100`);
      const values = obj(await expectOk('jira-priorities', res)).values;
      return names(values);
    },

    async projects() {
      const res = await http(route`/rest/api/3/project/search?maxResults=100&orderBy=key`);
      const values = obj(await expectOk('jira-projects', res)).values;
      return (Array.isArray(values) ? values : []).map(obj).map((p) => ({
        key: str(p.key),
        name: str(p.name),
        type: str(p.projectTypeKey),
      }));
    },
  };
}
