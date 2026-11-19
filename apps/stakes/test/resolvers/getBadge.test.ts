import { describe, expect, it, vi } from 'vitest';
import { chat, list } from '@forge/llm';
import { getBadgeHandler, type HandlerDeps } from '../../src/resolvers/handlers.js';
import { fakeStakesDeps } from '../fakes/deps.js';
import { snapshot } from '../fakes/snapshot.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));

const ctx = { accountId: 'acc-1', cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net' };

function handlerDeps() {
  const f = fakeStakesDeps();
  const canView = vi.fn(async () => true);
  const factory = vi.fn(
    () => ({ stakes: f.deps, jira: { canView, isAdmin: vi.fn() } }) as unknown as HandlerDeps,
  );
  return { f, factory, canView };
}

describe('getBadge resolver', () => {
  it('reads only the latest snapshot, with no graph, LLM or recompute call', async () => {
    const { f, factory, canView } = handlerDeps();
    await f.deps.snapshots.save(snapshot({ computedAt: '2000-01-01T00:00:00.000Z' }));
    const save = vi.spyOn(f.deps.snapshots, 'save');

    expect(await getBadgeHandler(factory)({ issueKey: ' pay-142 ' }, ctx)).toEqual({
      ok: true,
      data: { text: '89 · Silent fire' },
    });
    expect(canView).toHaveBeenCalledWith('PAY-142');
    for (const read of Object.values(f.graph)) expect(read).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(f.jira.issue).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects inaccessible issues before reading storage', async () => {
    const { f, factory, canView } = handlerDeps();
    canView.mockResolvedValue(false);
    const latest = vi.spyOn(f.deps.snapshots, 'latest');

    expect(await getBadgeHandler(factory)({ issueKey: 'PAY-142' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(latest).not.toHaveBeenCalled();
  });

  it('rejects a malformed key before reading storage', async () => {
    const { f, factory } = handlerDeps();
    const latest = vi.spyOn(f.deps.snapshots, 'latest');
    expect(await getBadgeHandler(factory)({ issueKey: 'not a key' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
  });
});
