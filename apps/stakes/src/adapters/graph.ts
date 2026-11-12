import api from '@forge/api';

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
