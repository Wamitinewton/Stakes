import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asUser: vi.fn(), asApp: vi.fn() }, route: vi.fn() }));
vi.mock('@forge/kvs', () => ({ kvs: { entity: () => ({}) }, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));

const { makeAdapters } = await import('../../src/adapters/index.js');

const ctx = { siteUrl: 'https://example.atlassian.net', cloudId: 'cloud-1' };

describe('makeAdapters', () => {
  it('gives app context a graph reader that throws and no Jira writer', () => {
    const app = makeAdapters({ as: 'app', ...ctx });
    expect(() => app.graph.dealsForIssue({ key: 'PAY-1', id: '1' })).toThrow(
      'Teamwork Graph is user-only',
    );
    expect('jiraWriter' in app).toBe(false);
    expect(typeof app.scoreField.set).toBe('function');
  });

  it('gives user context a working graph reader and a Jira writer', () => {
    const user = makeAdapters({ as: 'user', ...ctx });
    expect(typeof user.graph.dealsForIssue).toBe('function');
    expect(typeof user.jiraWriter.createIssues).toBe('function');
  });
});
