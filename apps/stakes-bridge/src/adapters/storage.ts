import { kvs } from '@forge/kvs';

export const HUBSPOT_TOKEN_KEY = 'bridge:hubspot-token';
export const SLACK_TOKEN_KEY = 'bridge:slack-token';
export const SLACK_CHANNEL_KEY = 'bridge:slack-channel';
export const SYNC_STATUS_KEY = 'bridge:sync-status';

export interface SyncStatus {
  lastSync: string | null;
  counts: { customers: number; deals: number; issues: number };
  lastErrorCode: string | null;
}

export const EMPTY_SYNC_STATUS: SyncStatus = {
  lastSync: null,
  counts: { customers: 0, deals: 0, issues: 0 },
  lastErrorCode: null,
};

export interface BridgeStore {
  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, value: string): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export function makeBridgeStore(store: BridgeStore = kvs as unknown as BridgeStore): BridgeStore {
  return store;
}

export async function slackChannel(store: BridgeStore): Promise<string | null> {
  return (await store.get<string>(SLACK_CHANNEL_KEY)) ?? null;
}

export async function syncStatus(store: BridgeStore): Promise<SyncStatus> {
  return (await store.get<SyncStatus>(SYNC_STATUS_KEY)) ?? EMPTY_SYNC_STATUS;
}
