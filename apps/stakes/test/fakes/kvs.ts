import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { EntityQuery, KvsLike } from '../../src/adapters/storage.js';

interface IndexDef {
  name: string;
  partition: string[];
  range: string;
}
interface EntityDef {
  attributes: Map<string, string>;
  indexes: Map<string, IndexDef>;
}

// Forge rejects a stored value above 240 KiB.
export const MAX_VALUE_BYTES = 240 * 1024;

function loadEntities(): Map<string, EntityDef> {
  const manifest = parse(readFileSync(new URL('../../manifest.yml', import.meta.url), 'utf8'));
  const defs = new Map<string, EntityDef>();
  for (const e of manifest.app.storage.entities as Array<{
    name: string;
    attributes: Record<string, { type: string }>;
    indexes: Array<string | { name: string; partition?: string[]; range: string }>;
  }>) {
    defs.set(e.name, {
      attributes: new Map(Object.entries(e.attributes).map(([k, v]) => [k, v.type])),
      indexes: new Map(
        e.indexes.map((i) =>
          typeof i === 'string'
            ? [i, { name: i, partition: [], range: i }]
            : [i.name, { name: i.name, partition: i.partition ?? [], range: i.range }],
        ),
      ),
    });
  }
  return defs;
}

type Where = { condition: string; values: Array<string | number> };

function matches(value: unknown, where: Where | null): boolean {
  if (!where) return true;
  const v = value as string | number;
  const [a, b] = where.values;
  switch (where.condition) {
    case 'EQUAL_TO':
      return v === a;
    case 'LESS_THAN':
      return v < a!;
    case 'LESS_THAN_EQUAL_TO':
      return v <= a!;
    case 'GREATER_THAN':
      return v > a!;
    case 'GREATER_THAN_EQUAL_TO':
      return v >= a!;
    case 'BETWEEN':
      return v >= a! && v <= b!;
    case 'BEGINS_WITH':
      return String(v).startsWith(String(a));
    default:
      throw new Error(`fake kvs: unsupported condition ${where.condition}`);
  }
}

// An in-memory stand-in for @forge/kvs that holds the code to the manifest: writing an
// undeclared entity or attribute, or querying an undeclared index, throws here the way
// it would fail on the site.
export function fakeKvs() {
  const entities = loadEntities();
  const plain = new Map<string, unknown>();
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  const calls = { batchSet: 0, batchGet: 0, batchDelete: 0 };

  const table = (name: string) => {
    if (!entities.has(name))
      throw new Error(`fake kvs: entity ${name} is not declared in manifest.yml`);
    if (!rows.has(name)) rows.set(name, new Map());
    return rows.get(name)!;
  };

  const checkValue = (name: string, value: Record<string, unknown>) => {
    const def = entities.get(name)!;
    for (const [attr, v] of Object.entries(value)) {
      const type = def.attributes.get(attr);
      if (!type) throw new Error(`fake kvs: ${name}.${attr} is not declared in manifest.yml`);
      const okType =
        type === 'any' ||
        (type === 'string' && typeof v === 'string') ||
        (type === 'boolean' && typeof v === 'boolean') ||
        (type === 'float' && typeof v === 'number') ||
        (type === 'integer' && Number.isInteger(v));
      if (!okType)
        throw new Error(`fake kvs: ${name}.${attr} must be ${type}, got ${JSON.stringify(v)}`);
    }
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size > MAX_VALUE_BYTES) throw new Error(`fake kvs: ${name} value is ${size} bytes`);
  };

  const setRow = (name: string, key: string, value: unknown) => {
    const t = table(name);
    checkValue(name, value as Record<string, unknown>);
    t.set(key, structuredClone(value) as Record<string, unknown>);
  };

  function query<T>(name: string, indexName: string, partition: unknown[]): EntityQuery<T> {
    const def = entities.get(name)!.indexes.get(indexName);
    if (!def)
      throw new Error(`fake kvs: index ${name}.${indexName} is not declared in manifest.yml`);
    if (partition.length !== def.partition.length) {
      throw new Error(
        `fake kvs: index ${name}.${indexName} takes ${def.partition.length} partition values`,
      );
    }
    let where: Where | null = null;
    let order: 'ASC' | 'DESC' = 'ASC';
    let after: string | null = null;
    let limit = 100;
    const q: EntityQuery<T> = {
      where(c) {
        where = c as Where;
        return q;
      },
      sort(s) {
        order = s as 'ASC' | 'DESC';
        return q;
      },
      cursor(c) {
        after = c;
        return q;
      },
      limit(n) {
        limit = n;
        return q;
      },
      async getMany() {
        const all = [...table(name).entries()]
          .filter(([, v]) => def.partition.every((p, i) => v[p] === partition[i]))
          .filter(([, v]) => v[def.range] !== undefined && matches(v[def.range], where))
          .sort(([ka, a], [kb, b]) => {
            const x = a[def.range] as string | number;
            const y = b[def.range] as string | number;
            const c = x < y ? -1 : x > y ? 1 : ka.localeCompare(kb);
            return order === 'ASC' ? c : -c;
          });
        const start = after ? Number(after) : 0;
        const page = all.slice(start, start + limit);
        const next = start + limit < all.length ? String(start + limit) : undefined;
        return {
          results: page.map(([key, value]) => ({ key, value: structuredClone(value) as T })),
          ...(next ? { nextCursor: next } : {}),
        };
      },
    };
    return q;
  }

  const kvs: KvsLike = {
    async get<T>(key: string) {
      return structuredClone(plain.get(key)) as T | undefined;
    },
    async set(key, value) {
      plain.set(key, structuredClone(value));
    },
    async delete(key) {
      plain.delete(key);
    },
    entity<T>(name: string) {
      table(name);
      return {
        async get(key: string) {
          return structuredClone(table(name).get(key)) as T | undefined;
        },
        async set(key: string, value: T) {
          setRow(name, key, value);
        },
        async delete(key: string) {
          table(name).delete(key);
        },
        query() {
          return {
            index: (indexName: string, o?: { partition?: unknown[] }) =>
              query<T>(name, indexName, o?.partition ?? []),
          };
        },
      };
    },
    async batchGet<T>(items: Array<{ key: string; entityName?: string }>) {
      calls.batchGet++;
      if (items.length > 25) throw new Error('fake kvs: batch over 25 items');
      const successfulKeys = items
        .map((i) => ({
          key: i.key,
          value: (i.entityName ? table(i.entityName).get(i.key) : plain.get(i.key)) as T,
        }))
        .filter((r) => r.value !== undefined)
        .map((r) => ({ ...r, value: structuredClone(r.value) }));
      return { successfulKeys, failedKeys: [] };
    },
    async batchSet(items) {
      calls.batchSet++;
      if (items.length > 25) throw new Error('fake kvs: batch over 25 items');
      for (const i of items) {
        if (i.entityName) setRow(i.entityName, i.key, i.value);
        else plain.set(i.key, structuredClone(i.value));
      }
      return { failedKeys: [] };
    },
    async batchDelete(items) {
      calls.batchDelete++;
      if (items.length > 25) throw new Error('fake kvs: batch over 25 items');
      for (const i of items) {
        if (i.entityName) table(i.entityName).delete(i.key);
        else plain.delete(i.key);
      }
      return { failedKeys: [] };
    },
  };

  return { kvs, plain, rows: (name: string) => table(name), calls };
}
