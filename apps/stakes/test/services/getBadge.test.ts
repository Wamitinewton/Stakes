import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@stakes/contracts';
import { getBadge } from '../../src/services/getBadge';
import { snapshot } from '../fakes/snapshot';

function deps(value: Snapshot | null) {
  return { snapshots: { latest: vi.fn(async () => value) } };
}

describe('getBadge', () => {
  it('renders the score and first badge from the latest snapshot', async () => {
    const store = deps(snapshot({ score: 89, badges: ['silent-fire'] }));
    expect(await getBadge(store, 'PAY-142')).toEqual({
      ok: true,
      data: { text: '89 · Silent fire' },
    });
    expect(store.snapshots.latest).toHaveBeenCalledWith('PAY-142');
  });

  it('renders the score alone when the snapshot has no badge', async () => {
    expect(await getBadge(deps(snapshot({ score: 42, badges: [] })), 'PAY-142')).toEqual({
      ok: true,
      data: { text: '42' },
    });
  });

  it('renders not scored when there is no snapshot', async () => {
    expect(await getBadge(deps(null), 'PAY-142')).toEqual({
      ok: true,
      data: { text: 'Not scored yet · Open the Stakes issue panel' },
    });
  });

  it('serves a stale snapshot without recomputing it', async () => {
    const store = deps(snapshot({ computedAt: '2000-01-01T00:00:00.000Z' }));
    expect(await getBadge(store, 'PAY-142')).toMatchObject({
      ok: true,
      data: { text: '89 · Silent fire' },
    });
    expect(store.snapshots.latest).toHaveBeenCalledTimes(1);
  });
});
