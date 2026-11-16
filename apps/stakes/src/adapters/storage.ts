import { kvs, Sort } from '@forge/kvs';
import type { Badge, ProjectKey, SeedStatus, Settings, Snapshot, Tier } from '@stakes/contracts';
import { DEFAULT_BANDS } from '../core/bands.js';
import { DEFAULT_WEIGHTS } from '../core/score.js';
import type { P95 } from '../core/normalise.js';

// ---------------------------------------------------------------------------------
// The slice of @forge/kvs these stores use. Tests pass an in-memory fake built from
// the manifest's entity declarations, so every index queried here must exist there.
// ---------------------------------------------------------------------------------

export interface EntityQuery<T> {
  where(condition: unknown): EntityQuery<T>;
  sort(sort: Sort): EntityQuery<T>;
  cursor(cursor: string): EntityQuery<T>;
  limit(limit: number): EntityQuery<T>;
  getMany(): Promise<{ results: Array<{ key: string; value: T }>; nextCursor?: string }>;
}

export interface EntityLike<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  query(): { index(name: string, options?: { partition?: unknown[] }): EntityQuery<T> };
}

export interface KvsLike {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  entity<T>(name: string): EntityLike<T>;
  batchGet<T>(
    items: Array<{ key: string; entityName?: string }>,
  ): Promise<{ successfulKeys: Array<{ key: string; value: T }>; failedKeys: unknown[] }>;
  batchSet<T>(
    items: Array<{ key: string; value: T; entityName?: string }>,
  ): Promise<{ failedKeys: Array<{ key: string; error: { code: string } }> }>;
  batchDelete(
    items: Array<{ key: string; entityName?: string }>,
  ): Promise<{ failedKeys: Array<{ key: string; error: { code: string } }> }>;
}

const forgeKvs = kvs as unknown as KvsLike;

// Storage keys accept letters, digits and a few separators. Ids from a CSV can hold
// anything, so other characters are escaped rather than rejected; the mapping is
// reversible and stable, so the same id always lands on the same row.
export function storageKey(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/[^A-Za-z0-9._-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`))
    .join(':');
}

// Forge batch calls take at most 25 items.
const BATCH = 25;
function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function batchGet<T>(store: KvsLike, entityName: string, keys: string[]): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks([...new Set(keys)])) {
    const res = await store.batchGet<T>(part.map((key) => ({ key, entityName })));
    out.push(...res.successfulKeys.map((r) => r.value));
  }
  return out;
}

async function batchSet<T>(
  store: KvsLike,
  entityName: string,
  rows: Array<{ key: string; value: T }>,
): Promise<void> {
  for (const part of chunks(rows)) {
    const res = await store.batchSet(part.map((r) => ({ ...r, entityName })));
    if (res.failedKeys.length > 0) {
      throw new Error(`storage batch write failed for ${res.failedKeys.length} ${entityName} rows`);
    }
  }
}

async function batchDelete(store: KvsLike, entityName: string, keys: string[]): Promise<void> {
  for (const part of chunks(keys)) {
    await store.batchDelete(part.map((key) => ({ key, entityName })));
  }
}

async function allPages<T>(query: EntityQuery<T>): Promise<Array<{ key: string; value: T }>> {
  const out: Array<{ key: string; value: T }> = [];
  let cursor: string | undefined;
  do {
    const page = await (cursor ? query.cursor(cursor) : query).limit(100).getMany();
    out.push(...page.results);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// The entity store drops a typed attribute whose value is null, and an index cannot
// hold one, so optional fields are left out on write and read back as null.
function withoutNulls<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as T;
}

// ---------------------------------------------------------------------------------
// Mirror of CRM data: customers, deals, the issue links between them, and demo
// conversation messages.
// ---------------------------------------------------------------------------------

export type MirrorSource = 'csv' | 'demo';

export interface MirrorCustomer {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
  ownerAccountId: string | null;
  source: MirrorSource;
}

export interface MirrorDeal {
  id: string;
  customerId: string;
  name: string;
  amountUsd: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  closed: boolean;
  ownerAccountId: string | null;
  issueKeys: string[];
  source: MirrorSource;
}

export interface MirrorMessage {
  id: string;
  issueKey: string;
  channel: string;
  author: string;
  text: string;
  at: string;
  url: string;
  source: MirrorSource;
}

interface LinkRow {
  issueKey: string;
  refId: string;
  source: MirrorSource;
}

export const ENTITIES = {
  customer: 'customer',
  deal: 'deal',
  dealIssue: 'deal_issue',
  customerIssue: 'customer_issue',
  message: 'message',
  snapshot: 'snapshot',
  history: 'history',
} as const;

const DEALS_VERSION_KEY = 'mirror:dealsVersion';

export interface MirrorStore {
  dealsForIssue(issueKey: string): Promise<MirrorDeal[]>;
  dealsForCustomer(customerId: string): Promise<MirrorDeal[]>;
  customersForIssue(issueKey: string): Promise<MirrorCustomer[]>;
  customersByIds(ids: string[]): Promise<MirrorCustomer[]>;
  searchCustomers(query: string): Promise<MirrorCustomer[]>;
  directIssueKeysForCustomer(customerId: string): Promise<string[]>;
  messagesForIssue(issueKey: string): Promise<MirrorMessage[]>;
  upsertCustomers(customers: MirrorCustomer[]): Promise<void>;
  upsertDeals(deals: MirrorDeal[]): Promise<void>;
  linkCustomers(
    links: Array<{ customerId: string; issueKey: string; source: MirrorSource }>,
  ): Promise<void>;
  upsertMessages(messages: MirrorMessage[]): Promise<void>;
  deleteBySource(
    source: MirrorSource,
  ): Promise<{ customers: number; deals: number; messages: number }>;
  dealsVersion(): Promise<number>;
  bumpDealsVersion(): Promise<number>;
}

const readCustomer = (c: MirrorCustomer): MirrorCustomer => ({
  ...c,
  renewalDate: c.renewalDate ?? null,
  ownerAccountId: c.ownerAccountId ?? null,
});
const readDeal = (d: MirrorDeal): MirrorDeal => ({
  ...d,
  closeDate: d.closeDate ?? null,
  ownerAccountId: d.ownerAccountId ?? null,
  issueKeys: d.issueKeys ?? [],
});

export function makeMirrorStore(store: KvsLike = forgeKvs): MirrorStore {
  const links = (name: string) => store.entity<LinkRow>(name);

  async function linkedIds(entity: string, issueKey: string): Promise<string[]> {
    const rows = await allPages(
      links(entity)
        .query()
        .index('by-issue', { partition: [issueKey] }),
    );
    return rows.map((r) => r.value.refId);
  }

  async function keysBySource(entity: string, source: MirrorSource): Promise<string[]> {
    const rows = await allPages(
      store
        .entity<{ source: string }>(entity)
        .query()
        .index('by-source', { partition: [source] }),
    );
    return rows.map((r) => r.key);
  }

  return {
    async dealsForIssue(issueKey) {
      const ids = await linkedIds(ENTITIES.dealIssue, issueKey);
      const deals = await batchGet<MirrorDeal>(
        store,
        ENTITIES.deal,
        ids.map((id) => storageKey(id)),
      );
      return deals.map(readDeal);
    },

    async dealsForCustomer(customerId) {
      const rows = await allPages(
        store
          .entity<MirrorDeal>(ENTITIES.deal)
          .query()
          .index('by-customer', { partition: [customerId] }),
      );
      return rows.map((r) => readDeal(r.value));
    },

    async customersForIssue(issueKey) {
      const ids = await linkedIds(ENTITIES.customerIssue, issueKey);
      return this.customersByIds(ids);
    },

    async customersByIds(ids) {
      const rows = await batchGet<MirrorCustomer>(
        store,
        ENTITIES.customer,
        ids.map((id) => storageKey(id)),
      );
      return rows.map(readCustomer);
    },

    async searchCustomers(query) {
      const exact = await this.customersByIds([query]);
      if (exact.length > 0) return exact;
      const rows = await allPages(
        store
          .entity<MirrorCustomer>(ENTITIES.customer)
          .query()
          .index('by-name')
          .where({ condition: 'BEGINS_WITH', values: [query] }),
      );
      return rows.map((r) => readCustomer(r.value));
    },

    async directIssueKeysForCustomer(customerId) {
      const rows = await allPages(
        links(ENTITIES.customerIssue)
          .query()
          .index('by-ref', { partition: [customerId] }),
      );
      return rows.map((r) => r.value.issueKey);
    },

    async messagesForIssue(issueKey) {
      const rows = await allPages(
        store
          .entity<MirrorMessage>(ENTITIES.message)
          .query()
          .index('by-issue', { partition: [issueKey] }),
      );
      return rows.map((r) => r.value);
    },

    async upsertCustomers(customers) {
      await batchSet(
        store,
        ENTITIES.customer,
        customers.map((c) => ({ key: storageKey(c.id), value: withoutNulls(c) })),
      );
    },

    // A deal's issue list is replaced, never merged: a re-import that drops an issue
    // must drop the link too, the same way the connector replaces its associations.
    async upsertDeals(deals) {
      await batchSet(
        store,
        ENTITIES.deal,
        deals.map((d) => ({ key: storageKey(d.id), value: withoutNulls(d) })),
      );
      for (const d of deals) {
        const existing = await allPages(
          links(ENTITIES.dealIssue)
            .query()
            .index('by-ref', { partition: [d.id] }),
        );
        const keep = new Set(d.issueKeys);
        const stale = existing.filter((r) => !keep.has(r.value.issueKey)).map((r) => r.key);
        await batchDelete(store, ENTITIES.dealIssue, stale);
        await batchSet(
          store,
          ENTITIES.dealIssue,
          d.issueKeys.map((issueKey) => ({
            key: storageKey(d.id, issueKey),
            value: { issueKey, refId: d.id, source: d.source },
          })),
        );
      }
    },

    async linkCustomers(rows) {
      await batchSet(
        store,
        ENTITIES.customerIssue,
        rows.map((l) => ({
          key: storageKey(l.customerId, l.issueKey),
          value: { issueKey: l.issueKey, refId: l.customerId, source: l.source },
        })),
      );
    },

    async upsertMessages(messages) {
      await batchSet(
        store,
        ENTITIES.message,
        messages.map((m) => ({ key: storageKey(m.id), value: m })),
      );
    },

    async deleteBySource(source) {
      const counts = { customers: 0, deals: 0, messages: 0 };
      for (const entity of [
        ENTITIES.dealIssue,
        ENTITIES.customerIssue,
        ENTITIES.deal,
        ENTITIES.customer,
        ENTITIES.message,
      ]) {
        const keys = await keysBySource(entity, source);
        await batchDelete(store, entity, keys);
        if (entity === ENTITIES.customer) counts.customers = keys.length;
        if (entity === ENTITIES.deal) counts.deals = keys.length;
        if (entity === ENTITIES.message) counts.messages = keys.length;
      }
      return counts;
    },

    async dealsVersion() {
      const v = await store.get<number>(DEALS_VERSION_KEY);
      return typeof v === 'number' ? v : 0;
    },

    async bumpDealsVersion() {
      const next = (await this.dealsVersion()) + 1;
      await store.set(DEALS_VERSION_KEY, next);
      return next;
    },
  };
}

// ---------------------------------------------------------------------------------
// Snapshots: the latest computed score per issue. History is a separate entity with
// one row per issue per day, so the latest-snapshot read is a single key lookup.
// ---------------------------------------------------------------------------------

export interface SnapshotStore {
  latest(issueKey: string): Promise<Snapshot | null>;
  latestMany(issueKeys: string[]): Promise<Snapshot[]>;
  save(snapshot: Snapshot): Promise<void>;
  deleteMany(issueKeys: string[]): Promise<void>;
}

const readSnapshot = (s: Snapshot): Snapshot => ({
  ...s,
  suggestedPriority: s.suggestedPriority ?? null,
});

export function makeSnapshotStore(store: KvsLike = forgeKvs): SnapshotStore {
  const entity = store.entity<Snapshot>(ENTITIES.snapshot);
  return {
    async latest(issueKey) {
      const row = await entity.get(storageKey(issueKey));
      return row ? readSnapshot(row) : null;
    },
    async latestMany(issueKeys) {
      const rows = await batchGet<Snapshot>(
        store,
        ENTITIES.snapshot,
        issueKeys.map((k) => storageKey(k)),
      );
      return rows.map(readSnapshot);
    },
    async save(snapshot) {
      await entity.set(storageKey(snapshot.issueKey), withoutNulls(snapshot));
    },
    async deleteMany(issueKeys) {
      await batchDelete(
        store,
        ENTITIES.snapshot,
        issueKeys.map((k) => storageKey(k)),
      );
    },
  };
}

export interface HistoryPoint {
  issueKey: string;
  projectKey: string;
  day: string;
  score: number;
  badges: Badge[];
  source: 'computed' | 'demo';
}

export interface HistoryStore {
  record(point: HistoryPoint): Promise<void>;
  recordMany(points: HistoryPoint[]): Promise<void>;
  // The most recent point on or before `day`, or null when there is no history that old.
  scoreOnOrBefore(issueKey: string, day: string): Promise<number | null>;
  since(issueKey: string, day: string): Promise<HistoryPoint[]>;
  deleteDemo(): Promise<number>;
}

export function makeHistoryStore(store: KvsLike = forgeKvs): HistoryStore {
  const entity = store.entity<HistoryPoint>(ENTITIES.history);
  // One row per issue per day: recomputing later the same day overwrites it, which is
  // the compaction the history needs, done at write time.
  const key = (p: HistoryPoint) => storageKey(p.issueKey, p.day);
  return {
    async record(point) {
      await entity.set(key(point), point);
    },
    async recordMany(points) {
      await batchSet(
        store,
        ENTITIES.history,
        points.map((p) => ({ key: key(p), value: p })),
      );
    },
    async scoreOnOrBefore(issueKey, day) {
      const page = await entity
        .query()
        .index('by-issue-day', { partition: [issueKey] })
        .where({ condition: 'LESS_THAN_EQUAL_TO', values: [day] })
        .sort(Sort.DESC)
        .limit(1)
        .getMany();
      return page.results[0]?.value.score ?? null;
    },
    async since(issueKey, day) {
      const rows = await allPages(
        entity
          .query()
          .index('by-issue-day', { partition: [issueKey] })
          .where({ condition: 'GREATER_THAN_EQUAL_TO', values: [day] })
          .sort(Sort.ASC),
      );
      return rows.map((r) => r.value);
    },
    async deleteDemo() {
      const rows = await allPages(entity.query().index('by-source', { partition: ['demo'] }));
      await batchDelete(
        store,
        ENTITIES.history,
        rows.map((r) => r.key),
      );
      return rows.length;
    },
  };
}

// ---------------------------------------------------------------------------------
// KVS values: settings, project percentiles and demo seed state.
// ---------------------------------------------------------------------------------

export const DEFAULT_SETTINGS: Settings = {
  weights: DEFAULT_WEIGHTS,
  weightsVersion: 1,
  bands: DEFAULT_BANDS,
  jumpThreshold: 20,
  projectsInScope: [],
  llmEnabled: false,
  dailyLlmBudgetCredits: 500,
  digestParentPageId: null,
};

const SETTINGS_KEY = 'settings:global';

export interface SettingsStore {
  get(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

// Stored settings are merged over the defaults, so a field added in a later release
// has a value on sites that saved their settings before it existed.
export function makeSettingsStore(store: KvsLike = forgeKvs): SettingsStore {
  return {
    async get() {
      const saved = await store.get<Partial<Settings>>(SETTINGS_KEY);
      if (!saved) return DEFAULT_SETTINGS;
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        weights: { ...DEFAULT_SETTINGS.weights, ...saved.weights },
        bands: {
          thresholds: { ...DEFAULT_SETTINGS.bands.thresholds, ...saved.bands?.thresholds },
          priorities: { ...DEFAULT_SETTINGS.bands.priorities, ...saved.bands?.priorities },
        },
      };
    },
    async save(settings) {
      await store.set(SETTINGS_KEY, settings);
    },
  };
}

export interface StoredPercentiles extends P95 {
  scoredCount: number;
  at: string;
  // Seeded values come with the demo dataset and are kept until the project has enough
  // real (non-demo) scored issues to replace them.
  seeded: boolean;
}

export interface PercentileStore {
  get(projectKey: ProjectKey): Promise<StoredPercentiles | null>;
  save(projectKey: ProjectKey, value: StoredPercentiles): Promise<void>;
  delete(projectKey: ProjectKey): Promise<void>;
}

export function makePercentileStore(store: KvsLike = forgeKvs): PercentileStore {
  const key = (p: string) => `percentiles:${p}`;
  return {
    async get(projectKey) {
      return (await store.get<StoredPercentiles>(key(projectKey))) ?? null;
    },
    async save(projectKey, value) {
      await store.set(key(projectKey), value);
    },
    async delete(projectKey) {
      await store.delete(key(projectKey));
    },
  };
}

export const EMPTY_SEED_STATUS: SeedStatus = {
  state: 'not-loaded',
  step: null,
  done: 0,
  total: 0,
  counts: { issues: 0, requests: 0, customers: 0, deals: 0, messages: 0, history: 0 },
  softwareProjectKey: null,
  serviceProjectKey: null,
  keyMap: {},
  message: null,
  updatedAt: null,
};

export interface SeedStore<R> {
  status(): Promise<SeedStatus>;
  saveStatus(status: SeedStatus): Promise<void>;
  // Everything the seeder created, by id, so removal deletes exactly that and nothing
  // the admin made themselves. Kept apart from the status the UI polls.
  record(): Promise<R | null>;
  saveRecord(record: R): Promise<void>;
  clear(): Promise<void>;
}

export function makeSeedStore<R>(store: KvsLike = forgeKvs): SeedStore<R> {
  return {
    async status() {
      return (await store.get<SeedStatus>('seed:status')) ?? EMPTY_SEED_STATUS;
    },
    async saveStatus(status) {
      await store.set('seed:status', status);
    },
    async record() {
      return (await store.get<R>('seed:record')) ?? null;
    },
    async saveRecord(record) {
      await store.set('seed:record', record);
    },
    async clear() {
      await store.delete('seed:status');
      await store.delete('seed:record');
    },
  };
}

// ---------------------------------------------------------------------------------
// Connector connection id.
// ---------------------------------------------------------------------------------

const CONNECTION_KEY = 'connector:connectionId';

export interface ConnectionStore {
  get(): Promise<string | null>;
  set(connectionId: string): Promise<void>;
  clear(): Promise<void>;
}

// The connector can only push once an admin has connected it in Atlassian
// administration; the connection id from that event is what every push must cite.
export function makeConnectionStore(
  store: Pick<KvsLike, 'get' | 'set' | 'delete'> = forgeKvs,
): ConnectionStore {
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
