import { kvs } from '@forge/kvs';

const CONNECTION_KEY = 'connector:connectionId';

export interface ConnectionStore {
  get(): Promise<string | null>;
  set(connectionId: string): Promise<void>;
  clear(): Promise<void>;
}

type KvsLike = Pick<typeof kvs, 'get' | 'set' | 'delete'>;

// The connector can only push once an admin has connected it in Atlassian
// administration; the connection id from that event is what every push must cite.
export function makeConnectionStore(store: KvsLike = kvs): ConnectionStore {
  return {
    async get() {
      const value = await store.get<string>(CONNECTION_KEY);
      return typeof value === 'string' ? value : null;
    },
    async set(connectionId) {
      await store.set(CONNECTION_KEY, connectionId);
    },
    async clear() {
      await store.delete(CONNECTION_KEY);
    },
  };
}
