import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/kvs', () => ({ kvs: {} }));

const { makeConnectionStore } = await import('../../src/adapters/storage.js');

describe('connection store', () => {
  it('stores, reads and clears the connector connection id', async () => {
    const data = new Map<string, unknown>();
    const kvs = {
      get: vi.fn(async (k: string) => data.get(k)),
      set: vi.fn(async (k: string, v: unknown) => void data.set(k, v)),
      delete: vi.fn(async (k: string) => void data.delete(k)),
    };
    const store = makeConnectionStore(kvs as never);
    expect(await store.get()).toBeNull();
    await store.set('conn-1');
    expect(await store.get()).toBe('conn-1');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
