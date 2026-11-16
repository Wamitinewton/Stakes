import { route } from '@forge/api';
import { asUserHttp, expectOk, JiraError, storyPointFieldIds, type JiraHttp } from './jira.js';

// Writes for the demo seeder. They run as the admin who clicked Load demo data, after
// confirmation, so everything created is attributed to a real person on the site.

export interface ProjectInfo {
  id: string;
  key: string;
  type: string;
  issueTypes: Array<{ id: string; name: string }>;
}

export interface NewIssue {
  projectId: string;
  issueTypeId: string;
  summary: string;
  priority?: string;
  labels?: string[];
  storyPoints?: { fieldId: string; value: number } | null;
  fixVersionIds?: string[];
  description?: string;
}

export interface JiraWriter {
  project(projectKey: string): Promise<ProjectInfo | null>;
  serviceDesk(
    projectKey: string,
  ): Promise<{ id: string; requestTypes: Array<{ id: string; name: string }> } | null>;
  scrumBoard(projectKey: string): Promise<number | null>;
  storyPointFieldId(): Promise<string | null>;
  // One entry per input, in order: the created key, or null where Jira refused that issue.
  createIssues(issues: NewIssue[]): Promise<Array<string | null>>;
  searchKeys(jql: string): Promise<string[]>;
  createRequest(input: {
    serviceDeskId: string;
    requestTypeId: string;
    summary: string;
    description: string;
  }): Promise<string>;
  updateIssue(key: string, input: { priority?: string; addLabels?: string[] }): Promise<void>;
  addComment(key: string, body: { type: 'doc'; version: 1; content: unknown[] }): Promise<void>;
  setProperty(key: string, propertyKey: string, value: unknown): Promise<void>;
  linkIssues(inwardKey: string, outwardKey: string): Promise<void>;
  deleteIssue(key: string): Promise<'deleted' | 'missing'>;
  createVersion(projectId: string, name: string, releaseDate: string): Promise<string>;
  deleteVersion(id: string): Promise<void>;
  createSprint(
    boardId: number,
    name: string,
    start: string,
    end: string,
    active: boolean,
  ): Promise<number>;
  moveToSprint(sprintId: number, keys: string[]): Promise<void>;
  deleteSprint(id: number): Promise<void>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

// Atlassian Document Format: Jira Cloud rejects plain-text descriptions.
const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

// Bulk create takes at most 50 issues per call.
export const BULK_CREATE_MAX = 50;

export function toIssueFields(issue: NewIssue): Obj {
  return {
    project: { id: issue.projectId },
    issuetype: { id: issue.issueTypeId },
    summary: issue.summary,
    ...(issue.priority ? { priority: { name: issue.priority } } : {}),
    ...(issue.labels ? { labels: issue.labels } : {}),
    ...(issue.fixVersionIds?.length
      ? { fixVersions: issue.fixVersionIds.map((id) => ({ id })) }
      : {}),
    ...(issue.storyPoints ? { [issue.storyPoints.fieldId]: issue.storyPoints.value } : {}),
    ...(issue.description ? { description: adf(issue.description) } : {}),
  };
}

export function makeJiraWriter(http: JiraHttp = asUserHttp): JiraWriter {
  return {
    async project(projectKey) {
      const res = await http(route`/rest/api/3/project/${projectKey}`);
      if (res.status === 404 || res.status === 403) return null;
      const p = obj(await expectOk('jira-project-read', res));
      const types = await http(
        route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=50`,
      );
      const meta = types.ok ? obj(await types.json()) : {};
      const issueTypes = list(meta.issueTypes ?? meta.values ?? p.issueTypes);
      return {
        id: str(p.id),
        key: str(p.key),
        type: str(p.projectTypeKey),
        issueTypes: issueTypes.map((t) => ({ id: str(t.id), name: str(t.name) })),
      };
    },

    async serviceDesk(projectKey) {
      const res = await http(route`/rest/servicedeskapi/servicedesk?limit=100`);
      const desk = list(obj(await expectOk('jsm-servicedesks', res)).values).find(
        (d) => str(d.projectKey) === projectKey,
      );
      if (!desk) return null;
      const id = str(desk.id);
      const types = await http(route`/rest/servicedeskapi/servicedesk/${id}/requesttype?limit=100`);
      const values = list(obj(await expectOk('jsm-request-types', types)).values);
      return { id, requestTypes: values.map((t) => ({ id: str(t.id), name: str(t.name) })) };
    },

    async scrumBoard(projectKey) {
      const res = await http(route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum`);
      if (!res.ok) return null;
      const board = list(obj(await res.json()).values)[0];
      return board && typeof board.id === 'number' ? board.id : null;
    },

    async storyPointFieldId() {
      const res = await http(route`/rest/api/3/field`);
      return res.ok ? (storyPointFieldIds(await res.json())[0] ?? null) : null;
    },

    // Bulk create keeps going past a bad issue: it creates the rest and lists the
    // failures by position, so the caller learns exactly which ones exist.
    async createIssues(issues) {
      const out: Array<string | null> = [];
      for (let i = 0; i < issues.length; i += BULK_CREATE_MAX) {
        const part = issues.slice(i, i + BULK_CREATE_MAX);
        const res = await http(route`/rest/api/3/issue/bulk`, {
          method: 'POST',
          body: { issueUpdates: part.map((issue) => ({ fields: toIssueFields(issue) })) },
        });
        if (!res.ok && res.status !== 400) throw new JiraError('jira-bulk-create', res.status);
        const body = obj(await res.json().catch(() => null));
        const failed = new Set(list(body.errors).map((e) => Number(e.failedElementNumber)));
        const created = list(body.issues).map((x) => str(x.key));
        let next = 0;
        for (let j = 0; j < part.length; j++)
          out.push(failed.has(j) ? null : (created[next++] ?? null));
        if (failed.size > 0)
          console.warn('jira bulk create refused issues', { refused: failed.size });
      }
      return out;
    },

    async searchKeys(jql) {
      const keys: string[] = [];
      let nextPageToken: string | undefined;
      do {
        const res = await http(route`/rest/api/3/search/jql`, {
          method: 'POST',
          body: {
            jql,
            fields: ['summary'],
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        const body = obj(await expectOk('jira-search', res));
        keys.push(...list(body.issues).map((x) => str(x.key)));
        nextPageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
      } while (nextPageToken);
      return keys;
    },

    async createRequest({ serviceDeskId, requestTypeId, summary, description }) {
      const res = await http(route`/rest/servicedeskapi/request`, {
        method: 'POST',
        body: { serviceDeskId, requestTypeId, requestFieldValues: { summary, description } },
      });
      return str(obj(await expectOk('jsm-create-request', res)).issueKey);
    },

    async updateIssue(key, { priority, addLabels }) {
      const res = await http(route`/rest/api/3/issue/${key}?notifyUsers=false`, {
        method: 'PUT',
        body: {
          ...(priority ? { fields: { priority: { name: priority } } } : {}),
          ...(addLabels?.length ? { update: { labels: addLabels.map((l) => ({ add: l })) } } : {}),
        },
      });
      await expectOk('jira-update-issue', res);
    },

    async addComment(key, body) {
      const res = await http(route`/rest/api/3/issue/${key}/comment`, {
        method: 'POST',
        body: { body },
      });
      await expectOk('jira-create-comment', res);
    },

    async setProperty(key, propertyKey, value) {
      const res = await http(route`/rest/api/3/issue/${key}/properties/${propertyKey}`, {
        method: 'PUT',
        body: value,
      });
      await expectOk('jira-set-property', res);
    },

    async linkIssues(inwardKey, outwardKey) {
      const res = await http(route`/rest/api/3/issueLink`, {
        method: 'POST',
        body: {
          type: { name: 'Relates' },
          inwardIssue: { key: inwardKey },
          outwardIssue: { key: outwardKey },
        },
      });
      await expectOk('jira-link-issues', res);
    },

    // Removal can be retried after a partial run, so an issue that is already gone is
    // a success, not an error.
    async deleteIssue(key) {
      const res = await http(route`/rest/api/3/issue/${key}?deleteSubtasks=true`, {
        method: 'DELETE',
      });
      if (res.status === 404) return 'missing';
      await expectOk('jira-delete-issue', res);
      return 'deleted';
    },

    async createVersion(projectId, name, releaseDate) {
      const res = await http(route`/rest/api/3/version`, {
        method: 'POST',
        body: { projectId: Number(projectId), name, releaseDate, released: false },
      });
      return str(obj(await expectOk('jira-create-version', res)).id);
    },

    async deleteVersion(id) {
      const res = await http(route`/rest/api/3/version/${id}`, { method: 'DELETE' });
      if (res.status !== 404) await expectOk('jira-delete-version', res);
    },

    // Jira only creates future sprints; an active one is created and then started. A
    // board that already has an active sprint refuses a second, which leaves this one
    // as a future sprint rather than failing the whole seed.
    async createSprint(boardId, name, start, end, active) {
      const res = await http(route`/rest/agile/1.0/sprint`, {
        method: 'POST',
        body: { name, originBoardId: boardId, startDate: start, endDate: end },
      });
      const id = Number(obj(await expectOk('jira-create-sprint', res)).id);
      if (active) {
        const started = await http(route`/rest/agile/1.0/sprint/${String(id)}`, {
          method: 'POST',
          body: { state: 'active', startDate: start, endDate: end },
        });
        if (!started.ok) console.warn('demo sprint left in the future', { status: started.status });
      }
      return id;
    },

    async moveToSprint(sprintId, keys) {
      for (let i = 0; i < keys.length; i += 50) {
        const res = await http(route`/rest/agile/1.0/sprint/${String(sprintId)}/issue`, {
          method: 'POST',
          body: { issues: keys.slice(i, i + 50) },
        });
        await expectOk('jira-move-to-sprint', res);
      }
    },

    async deleteSprint(id) {
      const res = await http(route`/rest/agile/1.0/sprint/${String(id)}`, { method: 'DELETE' });
      if (res.status !== 404) await expectOk('jira-delete-sprint', res);
    },
  };
}
