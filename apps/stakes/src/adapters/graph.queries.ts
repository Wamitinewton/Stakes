// Every graph read is a named operation so a failure can be traced in forge logs. The
// API accepts only curated fields or persisted queries; raw Cypher is closed to new apps.

export interface GraphQuery {
  operationName: string;
  kind: 'curated' | 'persisted';
  query: string;
}

// Curated: goals a work item contributes to. `id` is the issue ARI.
export const Q4_GOALS: GraphQuery = {
  operationName: 'stakes_q4_goals',
  kind: 'curated',
  query: `query stakes_q4_goals($id: ID!) {
  jiraWorkItemGoals(id: $id, first: 25) {
    edges { node { __typename } }
    pageInfo { hasNextPage endCursor }
  }
}`,
};

// No curated field covers conversations or team ownership, so these call queries
// registered in the explorer under the same key as the operation name.
const persisted = (operationName: string): GraphQuery => ({
  operationName,
  kind: 'persisted',
  query: `query ${operationName}($queryKey: String!, $queryParams: JSON) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { __typename } }
    pageInfo { hasNextPage endCursor }
  }
}`,
});

export const Q3_CONVERSATIONS = persisted('stakes_q3_conversations');
export const Q5_TEAM = persisted('stakes_q5_team');

export function issueAri(cloudId: string, issueId: string): string {
  return `ari:cloud:jira:${cloudId}:issue/${issueId}`;
}

export type Connection = { edges?: unknown[] } | null | undefined;

// A connection with no edges is "empty"; callers decide whether that is expected.
export function edgeCount(data: Record<string, Connection> | null | undefined): number {
  if (!data) return 0;
  return Object.values(data).reduce((n, conn) => n + (conn?.edges?.length ?? 0), 0);
}
