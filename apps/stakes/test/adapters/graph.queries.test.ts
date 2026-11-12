import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asUser: vi.fn() } }));

const { classifyGraphResponse } = await import('../../src/adapters/graph.js');
const { Q3_CONVERSATIONS, Q4_GOALS, Q5_TEAM, edgeCount, issueAri } =
  await import('../../src/adapters/graph.queries.js');

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/graph/${name}.json`, import.meta.url), 'utf8'));

describe.each([
  ['q3', Q3_CONVERSATIONS],
  ['q4', Q4_GOALS],
  ['q5', Q5_TEAM],
])('%s contract', (prefix, query) => {
  const classify = (name: string) => {
    const body = fixture(`${prefix}.${name}`);
    return classifyGraphResponse(200, body, (d) => edgeCount(d as never) > 0);
  };

  it('names the operation inside the query text', () => {
    expect(query.query).toContain(`query ${query.operationName}(`);
  });

  it('accepts the happy response', () => {
    expect(classify('happy').ok).toBe(true);
  });

  it('marks an empty response as degraded when links are expected', () => {
    expect(classify('empty')).toMatchObject({ ok: false, reason: 'unexpected-empty' });
  });

  it('marks a 200 with errors as degraded', () => {
    expect(classify('error')).toMatchObject({ ok: false, reason: 'partial-errors' });
  });
});

describe('helpers', () => {
  it('builds an issue ARI', () => {
    expect(issueAri('c-1', '10042')).toBe('ari:cloud:jira:c-1:issue/10042');
  });

  it('counts edges across connections and tolerates nulls', () => {
    expect(edgeCount({ a: { edges: [1, 2] }, b: null })).toBe(2);
    expect(edgeCount(null)).toBe(0);
  });
});
