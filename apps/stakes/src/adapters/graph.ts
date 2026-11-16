import api from '@forge/api';
import type { GoalStatus, IssueKey } from '@stakes/contracts';
import {
  Q1_DEALS,
  Q3_CONVERSATIONS,
  Q4_GOALS,
  Q5_TEAM,
  issueAri,
  nodesOf,
  type Connection,
  type GraphQuery,
} from './graph.queries.js';

export type GraphResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      degraded: true;
      reason: 'partial-errors' | 'unexpected-empty' | 'http-error' | 'timeout';
      data?: T;
    };

// The Teamwork Graph API can answer HTTP 200 with an errors array, or with an empty
// list when scopes are missing. Both are degraded reads, never "no evidence".
export function classifyGraphResponse<T>(
  status: number,
  body: { data?: T | null; errors?: unknown[] } | null,
  expectNonEmpty: (data: T) => boolean = () => true,
): GraphResult<T> {
  if (status < 200 || status >= 300 || !body)
    return { ok: false, degraded: true, reason: 'http-error' };
  const data = body.data ?? undefined;
  if (body.errors && body.errors.length > 0) {
    return { ok: false, degraded: true, reason: 'partial-errors', ...(data ? { data } : {}) };
  }
  if (data === undefined) return { ok: false, degraded: true, reason: 'http-error' };
  if (!expectNonEmpty(data)) return { ok: false, degraded: true, reason: 'unexpected-empty', data };
  return { ok: true, data };
}

type GraphRequest = (
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface GraphClient {
  query<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    expectNonEmpty?: (data: T) => boolean,
  ): Promise<GraphResult<T>>;
}

// The graph API only accepts calls as a user, so there is no app-context variant of
// this client at all.
export function makeGraphClient(
  request: GraphRequest = (q, v, op) => api.asUser().requestTeamworkGraph(q, v, op),
): GraphClient {
  return {
    async query<T>(
      operationName: string,
      query: string,
      variables: Record<string, unknown>,
      expectNonEmpty?: (data: T) => boolean,
    ) {
      try {
        const res = await request(query, variables, operationName);
        const body = (await res.json().catch(() => null)) as {
          data?: T | null;
          errors?: unknown[];
        } | null;
        const result = classifyGraphResponse(res.status, body, expectNonEmpty);
        console.log('graph query', {
          operationName,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
        });
        return result;
      } catch {
        console.warn('graph query threw', { operationName });
        return { ok: false, degraded: true, reason: 'http-error' };
      }
    },
  };
}

// ---------------------------------------------------------------------------------
// Reader for the five questions Stakes asks the graph about one issue.
// ---------------------------------------------------------------------------------

export interface GraphDeal {
  id: string;
  name: string;
  amountUsd: number;
  stage: string;
  closed: boolean;
  closeDate: string | null;
  accountName: string | null;
  url: string;
}

export interface GraphConversation {
  id: string;
  title: string;
  at: string;
  url: string;
}

export interface GraphGoal {
  id: string;
  name: string;
  status: GoalStatus;
  url: string;
}

export interface GraphTeam {
  id: string;
  name: string;
}

export interface IssueRef {
  key: IssueKey;
  id: string;
}

export interface GraphReader {
  dealsForIssue(issue: IssueRef): Promise<GraphResult<GraphDeal[]>>;
  escalationsForIssue(issue: IssueRef): Promise<GraphResult<never[]>>;
  conversationsForIssue(
    issue: IssueRef,
    sinceDays: number,
  ): Promise<GraphResult<GraphConversation[]>>;
  goalsForIssue(issue: IssueRef): Promise<GraphResult<GraphGoal[]>>;
  teamForIssue(issue: IssueRef): Promise<GraphResult<GraphTeam | null>>;
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

export function parseDeals(data: Record<string, Connection>): GraphDeal[] {
  return nodesOf(data)
    .filter((n) => str(n.externalId || n.id) !== '')
    .map((n) => ({
      id: str(n.externalId) || str(n.id),
      name: str(n.displayName),
      amountUsd: Number(obj(n.opportunityAmount).value) || 0,
      stage: str(n.stage),
      closed: n.isClosed === true,
      closeDate: strOrNull(n.dealClosedAt)?.slice(0, 10) ?? null,
      accountName: strOrNull(n.accountName),
      url: str(n.url),
    }));
}

export function parseConversations(data: Record<string, Connection>): GraphConversation[] {
  return nodesOf(data)
    .filter((n) => str(n.id) !== '')
    .map((n) => ({
      id: str(n.id),
      title: str(n.displayName),
      at: str(n.lastUpdatedAt) || str(n.createdAt),
      url: str(n.url),
    }));
}

const GOAL_STATES: Record<string, GoalStatus> = {
  on_track: 'on-track',
  at_risk: 'at-risk',
  off_track: 'off-track',
};

export function parseGoals(data: Record<string, Connection>): GraphGoal[] {
  return nodesOf(data)
    .filter((n) => str(n.id) !== '')
    .map((n) => ({
      id: str(n.id),
      name: str(n.name),
      status: GOAL_STATES[str(obj(n.state).value).toLowerCase()] ?? 'unknown',
      url: str(n.url),
    }));
}

function mapResult<A, B>(result: GraphResult<A>, map: (a: A) => B): GraphResult<B> {
  if (result.ok) return { ok: true, data: map(result.data) };
  return {
    ok: false,
    degraded: true,
    reason: result.reason,
    ...(result.data !== undefined ? { data: map(result.data) } : {}),
  };
}

export function makeGraphReader(client: GraphClient, cloudId: string): GraphReader {
  const run = (q: GraphQuery, variables: Record<string, unknown>) =>
    client.query<Record<string, Connection>>(q.operationName, q.query, variables);
  const persisted = (q: GraphQuery, issue: IssueRef, extra: Record<string, unknown> = {}) =>
    run(q, { queryKey: q.operationName, queryParams: { issueKey: issue.key, ...extra } });

  return {
    // An issue with no deals is normal, so an empty answer is a real "none" here; only
    // errors make the read degraded.
    async dealsForIssue(issue) {
      return mapResult(await persisted(Q1_DEALS, issue), parseDeals);
    },
    // No graph relationship links work items to support escalations; they come from
    // linked service-desk requests over Jira REST instead.
    async escalationsForIssue() {
      return { ok: true, data: [] };
    },
    async conversationsForIssue(issue, sinceDays) {
      return mapResult(await persisted(Q3_CONVERSATIONS, issue, { sinceDays }), parseConversations);
    },
    async goalsForIssue(issue) {
      return mapResult(await run(Q4_GOALS, { id: issueAri(cloudId, issue.id) }), parseGoals);
    },
    async teamForIssue(issue) {
      return mapResult(await persisted(Q5_TEAM, issue), (d) => {
        const n = nodesOf(d)[0];
        return n ? { id: str(n.id), name: str(n.displayName) } : null;
      });
    },
  };
}

// Product triggers and scheduled jobs run without a user, and the graph only answers
// users. Handing them a reader that throws makes that mistake fail in the first test.
export function appContextGraphReader(): GraphReader {
  const refuse = () => {
    throw new Error('Teamwork Graph is user-only');
  };
  return {
    dealsForIssue: refuse,
    escalationsForIssue: refuse,
    conversationsForIssue: refuse,
    goalsForIssue: refuse,
    teamForIssue: refuse,
  };
}
