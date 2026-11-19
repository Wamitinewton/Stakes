import { describe, expect, it, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/digest.js', () => ({ weeklyDigest: run }));

const { runDigestNowHandler } = await import('../../src/resolvers/digest.js');

const ctx = { accountId: 'account-1', cloudId: 'cloud-1', siteUrl: '' };
const completed = {
  at: '2026-11-16T06:00:00.000Z',
  status: 'completed' as const,
  reason: null,
  created: 1,
  updated: 0,
  failed: 0,
};

function factory(admin: boolean) {
  const deps = { jira: { isAdmin: vi.fn(async () => admin) }, digest: {} as never };
  return { deps, makeDeps: vi.fn(() => deps) };
}

describe('runDigestNow resolver', () => {
  it('runs the shared digest service manually for an admin', async () => {
    run.mockResolvedValue(completed);
    const f = factory(true);
    expect(await runDigestNowHandler(f.makeDeps)({ confirmed: true }, ctx)).toEqual({
      ok: true,
      data: completed,
    });
    expect(run).toHaveBeenCalledWith(f.deps.digest, { manual: true });
  });

  it('does not run without confirmation', async () => {
    run.mockClear();
    const f = factory(true);
    expect(await runDigestNowHandler(f.makeDeps)({}, ctx)).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(f.deps.jira.isAdmin).not.toHaveBeenCalled();
  });

  it('rejects non-admins before running', async () => {
    run.mockClear();
    const f = factory(false);
    expect(await runDigestNowHandler(f.makeDeps)({ confirmed: true }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ADMIN' },
    });
    expect(run).not.toHaveBeenCalled();
  });
});
