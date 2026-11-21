import type { IssueDetails, JiraReader, LinkedRequest } from '../../src/adapters/jira';
import type { JiraWriter, NewIssue } from '../../src/adapters/jiraWriter';

interface FakeIssue {
  key: string;
  projectKey: string;
  summary: string;
  priority: string;
  labels: string[];
  typeId: string;
  fixVersionIds: string[];
  properties: Record<string, unknown>;
  sprintId: number | null;
}

// A small Jira site in memory: projects keep a counter that never goes backwards, so
// the seeder's key-padding logic is exercised the way a real site behaves.
export function fakeSite(
  opts: { nextPay?: number; nextHelp?: number; refuse?: (issue: NewIssue) => boolean } = {},
) {
  const counters: Record<string, number> = { PAY: opts.nextPay ?? 1, HELP: opts.nextHelp ?? 1 };
  const projects: Record<string, { id: string; type: string }> = {
    PAY: { id: '10000', type: 'software' },
    HELP: { id: '10001', type: 'service_desk' },
    OPS: { id: '10002', type: 'business' },
  };
  const projectById = (id: string) => Object.entries(projects).find(([, p]) => p.id === id)![0];
  const issues = new Map<string, FakeIssue>();
  const links: Array<[string, string]> = [];
  const versions = new Map<string, string>();
  const sprints = new Map<number, { name: string; active: boolean }>();
  let ids = 100;
  const calls = { deletes: 0, creates: 0 };

  const create = (projectKey: string, fields: Partial<FakeIssue>) => {
    const key = `${projectKey}-${counters[projectKey]!++}`;
    issues.set(key, {
      key,
      projectKey,
      summary: '',
      priority: 'Medium',
      labels: [],
      typeId: '1',
      fixVersionIds: [],
      properties: {},
      sprintId: null,
      ...fields,
    });
    calls.creates++;
    return key;
  };

  const writer: JiraWriter = {
    async project(key) {
      const p = projects[key];
      return p
        ? {
            id: p.id,
            key,
            type: p.type,
            issueTypes: [
              { id: '1', name: 'Story' },
              { id: '2', name: 'Bug' },
              { id: '3', name: 'Task' },
              { id: '4', name: 'Epic' },
            ],
          }
        : null;
    },
    async serviceDesk(key) {
      return key === 'HELP'
        ? {
            id: '7',
            requestTypes: [
              { id: '70', name: 'Emailed request' },
              { id: '71', name: 'Get IT help' },
            ],
          }
        : null;
    },
    async scrumBoard(key) {
      return key === 'PAY' ? 5 : null;
    },
    async storyPointFieldId() {
      return 'customfield_10016';
    },
    async createIssues(list) {
      return list.map((i) =>
        opts.refuse?.(i)
          ? null
          : create(projectById(i.projectId), {
              summary: i.summary,
              priority: i.priority ?? 'Medium',
              labels: i.labels ?? [],
              typeId: i.issueTypeId,
              fixVersionIds: i.fixVersionIds ?? [],
            }),
      );
    },
    async searchKeys(jql) {
      const label = /labels = "([^"]+)"/.exec(jql)?.[1];
      return [...issues.values()]
        .filter((i) => label && i.labels.includes(label))
        .map((i) => i.key);
    },
    async createRequest({ summary }) {
      return create('HELP', { summary });
    },
    async updateIssue(key, { priority, addLabels }) {
      const issue = issues.get(key)!;
      if (priority) issue.priority = priority;
      issue.labels = [...new Set([...issue.labels, ...(addLabels ?? [])])];
    },
    async addComment() {
      return '10000';
    },
    async addRequestComment() {
      return '20000';
    },
    async setProperty(key, propertyKey, value) {
      issues.get(key)!.properties[propertyKey] = value;
    },
    async linkIssues(inward, outward) {
      links.push([inward, outward]);
    },
    async deleteIssue(key) {
      calls.deletes++;
      if (!issues.has(key)) return 'missing';
      issues.delete(key);
      for (let i = links.length - 1; i >= 0; i--) if (links[i]!.includes(key)) links.splice(i, 1);
      return 'deleted';
    },
    async createVersion(_projectId, name) {
      const id = String(ids++);
      versions.set(id, name);
      return id;
    },
    async deleteVersion(id) {
      versions.delete(id);
    },
    async createSprint(_board, name, _start, _end, active) {
      const id = ids++;
      sprints.set(id, { name, active });
      return id;
    },
    async moveToSprint(sprintId, keys) {
      for (const k of keys) issues.get(k)!.sprintId = sprintId;
    },
    async deleteSprint(id) {
      sprints.delete(id);
    },
  };

  // Reads back what the seeder wrote, the way the real reader would.
  const reader: Pick<JiraReader, 'issue' | 'linkedRequests' | 'bridgeCrm'> = {
    async issue(key) {
      const i = issues.get(key);
      if (!i) return null;
      return {
        key,
        id: key.replace(/\D/g, ''),
        projectKey: i.projectKey,
        summary: i.summary,
        status: 'To Do',
        statusCategory: 'new',
        priority: i.priority,
        assigneeAccountId: null,
        fixVersions: i.fixVersionIds.map((v) => versions.get(v) ?? v),
        components: [],
        storyPoints: null,
        labels: i.labels,
        updated: '2026-01-01T00:00:00.000Z',
        url: `/browse/${key}`,
      } satisfies IssueDetails;
    },
    async linkedRequests(key) {
      const linked = links.filter(([, out]) => out === key).map(([inward]) => issues.get(inward)!);
      const requests: LinkedRequest[] = linked.map((i) => {
        const demo = i.properties['stakes.demo'] as {
          createdAt: string;
          slaBreachAt: string | null;
        };
        return {
          key: i.key,
          summary: i.summary,
          priority: i.priority,
          createdAt: demo.createdAt,
          slaBreachAt: demo.slaBreachAt,
          escalated: i.labels.includes('escalation'),
          assigneeAccountId: null,
          url: `/browse/${i.key}`,
        };
      });
      return { requests, hidden: 0 };
    },
    async bridgeCrm() {
      return null;
    },
  };

  return { writer, reader, issues, links, versions, sprints, counters, calls };
}
