import { route } from '@forge/api';
import type { IssueKey, ProjectKey, SprintBoard, SprintOption } from '@stakes/contracts';
import {
  asUserHttp,
  expectOk,
  parseIssue,
  storyPointFieldIds,
  type IssueDetails,
  type JiraHttp,
} from './jira';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface AgileSprint extends SprintOption {
  state: 'future' | 'active' | 'closed' | 'unknown';
  completeDate: string | null;
}

export interface SprintAdapter {
  boards(projectKey: ProjectKey): Promise<SprintBoard[]>;
  boardProjects(boardId: number): Promise<ProjectKey[]>;
  sprints(boardId: number, state: 'future' | 'closed'): Promise<AgileSprint[]>;
  sprintIssues(sprintId: number): Promise<IssueDetails[]>;
  unassignedIssues(projectKeys: ProjectKey[]): Promise<IssueDetails[]>;
  completedPoints(boardId: number): Promise<number[]>;
  moveIssues(sprintId: number, issueKeys: IssueKey[]): Promise<void>;
}

export function parseSprints(body: unknown): AgileSprint[] {
  const values = obj(body).values;
  if (!Array.isArray(values)) return [];
  return values.map(obj).map((sprint) => {
    const state = str(sprint.state);
    return {
      id: typeof sprint.id === 'number' ? sprint.id : 0,
      name: str(sprint.name),
      state: ['future', 'active', 'closed'].includes(state)
        ? (state as AgileSprint['state'])
        : 'unknown',
      completeDate: typeof sprint.completeDate === 'string' ? sprint.completeDate : null,
    };
  });
}

export function parseBoards(body: unknown): SprintOption[] {
  const values = obj(body).values;
  if (!Array.isArray(values)) return [];
  return values
    .map(obj)
    .flatMap((board) =>
      typeof board.id === 'number' && str(board.name)
        ? [{ id: board.id, name: str(board.name) }]
        : [],
    );
}

async function agilePages(
  http: JiraHttp,
  path: (startAt: number) => ReturnType<typeof route>,
  operation: string,
): Promise<unknown[]> {
  const values: unknown[] = [];
  let startAt = 0;
  let last = false;
  do {
    const body = obj(await expectOk(operation, await http(path(startAt))));
    const page = Array.isArray(body.values) ? body.values : [];
    values.push(...page);
    last = body.isLast === true || page.length === 0;
    startAt += page.length;
  } while (!last);
  return values;
}

const ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'fixVersions',
  'components',
  'labels',
  'updated',
  'project',
];

export function makeSprintAdapter(siteUrl: string, http: JiraHttp = asUserHttp): SprintAdapter {
  let pointFields: Promise<string[]> | null = null;
  const storyPoints = () =>
    (pointFields ??= http(route`/rest/api/3/field`)
      .then((res) => (res.ok ? res.json() : []))
      .then(storyPointFieldIds)
      .catch(() => []));

  async function searchUnassigned(projectKeys: ProjectKey[]): Promise<IssueDetails[]> {
    if (projectKeys.length === 0) return [];
    const fields = await storyPoints();
    const issues: IssueDetails[] = [];
    let nextPageToken: string | undefined;
    do {
      const res = await http(route`/rest/api/3/search/jql`, {
        method: 'POST',
        body: {
          jql: `project in (${projectKeys.map((key) => `"${key}"`).join(', ')}) AND sprint IS EMPTY AND statusCategory != Done ORDER BY key ASC`,
          fields: [...ISSUE_FIELDS, ...fields],
          maxResults: 100,
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      });
      const body = obj(await expectOk('jira-unassigned-issues', res));
      const page = Array.isArray(body.issues) ? body.issues : [];
      issues.push(...page.map((issue) => parseIssue(str(obj(issue).key), issue, siteUrl, fields)));
      nextPageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    } while (nextPageToken);
    return issues;
  }

  async function sprintIssues(sprintId: number): Promise<IssueDetails[]> {
    const fields = await storyPoints();
    const issues: IssueDetails[] = [];
    let startAt = 0;
    let last = false;
    do {
      const res = await http(
        route`/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=100&fields=${[...ISSUE_FIELDS, ...fields].join(',')}`,
      );
      const body = obj(await expectOk('jira-sprint-issues', res));
      const page = Array.isArray(body.issues) ? body.issues : [];
      issues.push(...page.map((issue) => parseIssue(str(obj(issue).key), issue, siteUrl, fields)));
      last = body.isLast === true || page.length === 0;
      startAt += page.length;
    } while (!last);
    return issues;
  }

  return {
    async boards(projectKey) {
      const raw = await agilePages(
        http,
        (startAt) =>
          route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&startAt=${startAt}&maxResults=100`,
        'jira-boards',
      );
      const boards = parseBoards({ values: raw });
      return Promise.all(
        boards.map(async (board) => ({
          ...board,
          futureSprints: (await this.sprints(board.id, 'future')).map(({ id, name }) => ({
            id,
            name,
          })),
        })),
      );
    },

    async boardProjects(boardId) {
      const raw = await agilePages(
        http,
        (startAt) =>
          route`/rest/agile/1.0/board/${boardId}/project?startAt=${startAt}&maxResults=100`,
        'jira-board-projects',
      );
      return raw
        .map((project) => str(obj(project).key))
        .filter((key) => key !== '') as ProjectKey[];
    },

    async sprints(boardId, state) {
      const raw = await agilePages(
        http,
        (startAt) =>
          route`/rest/agile/1.0/board/${boardId}/sprint?state=${state}&startAt=${startAt}&maxResults=100`,
        'jira-sprints',
      );
      return parseSprints({ values: raw });
    },

    sprintIssues,
    unassignedIssues: searchUnassigned,

    async completedPoints(boardId) {
      const closed = (await this.sprints(boardId, 'closed'))
        .sort((a, b) => (b.completeDate ?? '').localeCompare(a.completeDate ?? ''))
        .slice(0, 3);
      return Promise.all(
        closed.map(async (sprint) =>
          (await sprintIssues(sprint.id))
            .filter((issue) => issue.statusCategory === 'done')
            .reduce((sum, issue) => sum + (issue.storyPoints ?? 0), 0),
        ),
      );
    },

    async moveIssues(sprintId, issueKeys) {
      for (let index = 0; index < issueKeys.length; index += 50) {
        const issues = issueKeys.slice(index, index + 50);
        await expectOk(
          'jira-sprint-move',
          await http(route`/rest/agile/1.0/sprint/${sprintId}/issue`, {
            method: 'POST',
            body: { issues },
          }),
        );
      }
    },
  };
}
