import api, { route } from '@forge/api';
import { BRIDGE_CRM_PROPERTY_KEY, type BridgeCrmProperty, type IssueKey } from '@stakes/contracts';

export type JiraRoute = ReturnType<typeof route>;
export interface JiraResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type JiraHttp = (
  path: JiraRoute,
  init?: { method?: string; body?: unknown },
) => Promise<JiraResponse>;

export const asAppHttp: JiraHttp = (path, init) =>
  api.asApp().requestJira(path, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

export interface JiraBridge {
  writeBridgeCrm(issueKey: IssueKey, value: BridgeCrmProperty): Promise<void>;
  clearBridgeCrm(issueKey: IssueKey): Promise<void>;
}

export function makeJiraBridge(http: JiraHttp = asAppHttp): JiraBridge {
  return {
    async writeBridgeCrm(issueKey, value) {
      const response = await http(
        route`/rest/api/3/issue/${issueKey}/properties/${BRIDGE_CRM_PROPERTY_KEY}`,
        { method: 'PUT', body: value },
      );
      if (!response.ok) throw new Error(`Jira property write failed with HTTP ${response.status}`);
    },
    async clearBridgeCrm(issueKey) {
      const response = await http(
        route`/rest/api/3/issue/${issueKey}/properties/${BRIDGE_CRM_PROPERTY_KEY}`,
        { method: 'DELETE' },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Jira property delete failed with HTTP ${response.status}`);
      }
    },
  };
}
