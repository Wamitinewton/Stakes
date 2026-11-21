import api, { route } from '@forge/api';
import {
  BRIDGE_CRM_PROPERTY_KEY,
  isIssueKey,
  SHIP_NOTICE_PROPERTY_KEY,
  ShipNoticeProperty,
  type BridgeCrmProperty,
  type IssueKey,
  type ShipNoticeProperty as ShipNotice,
} from '@stakes/contracts';

export const SENT_UNDELIVERED_JQL =
  'issue.property[stakes.shipNotice].status = sent AND issue.property[stakes.shipNotice].deliveredAt IS EMPTY';

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

export const asUserHttp: JiraHttp = (path, init) =>
  api.asUser().requestJira(path, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

export interface JiraAdmin {
  isAdmin(): Promise<boolean>;
}

export function makeJiraAdmin(http: JiraHttp = asUserHttp): JiraAdmin {
  return {
    async isAdmin() {
      const response = await http(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
      if (!response.ok) return false;
      return obj(obj(obj(await response.json()).permissions).ADMINISTER).havePermission === true;
    },
  };
}

export interface PendingShipNotice {
  issueKey: IssueKey;
  notice: ShipNotice;
}

export interface JiraBridge {
  writeBridgeCrm(issueKey: IssueKey, value: BridgeCrmProperty): Promise<void>;
  clearBridgeCrm(issueKey: IssueKey): Promise<void>;
  pendingShipNotices(): Promise<PendingShipNotice[]>;
  ownerEmail(accountId: string): Promise<string | null>;
  writeShipNotice(issueKey: IssueKey, value: ShipNotice): Promise<void>;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {});
const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.map(obj) : []);

export function makeJiraBridge(http: JiraHttp = asAppHttp): JiraBridge {
  const setProperty = async (issueKey: IssueKey, propertyKey: string, value: unknown) => {
    const response = await http(route`/rest/api/3/issue/${issueKey}/properties/${propertyKey}`, {
      method: 'PUT',
      body: value,
    });
    if (!response.ok) throw new Error(`Jira property write failed with HTTP ${response.status}`);
  };

  return {
    writeBridgeCrm(issueKey, value) {
      return setProperty(issueKey, BRIDGE_CRM_PROPERTY_KEY, value);
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
    async pendingShipNotices() {
      const notices: PendingShipNotice[] = [];
      let nextPageToken: string | undefined;
      do {
        const response = await http(route`/rest/api/3/search/jql`, {
          method: 'POST',
          body: {
            jql: SENT_UNDELIVERED_JQL,
            fields: [],
            properties: [SHIP_NOTICE_PROPERTY_KEY],
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        if (!response.ok) throw new Error(`Jira notice search failed with HTTP ${response.status}`);
        const body = obj(await response.json());
        for (const issue of list(body.issues)) {
          const key = issue.key;
          const parsed = ShipNoticeProperty.safeParse(
            obj(issue.properties)[SHIP_NOTICE_PROPERTY_KEY],
          );
          if (isIssueKey(key) && parsed.success && !parsed.data.deliveredAt) {
            notices.push({ issueKey: key, notice: parsed.data });
          } else if (isIssueKey(key)) {
            console.warn('invalid ship notice property', { issueKey: key });
          }
        }
        nextPageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
      } while (nextPageToken);
      return notices;
    },
    async ownerEmail(accountId) {
      const response = await http(route`/rest/api/3/user?accountId=${accountId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Jira user read failed with HTTP ${response.status}`);
      const email = obj(await response.json()).emailAddress;
      return typeof email === 'string' && email ? email : null;
    },
    writeShipNotice(issueKey, value) {
      return setProperty(issueKey, SHIP_NOTICE_PROPERTY_KEY, ShipNoticeProperty.parse(value));
    },
  };
}
