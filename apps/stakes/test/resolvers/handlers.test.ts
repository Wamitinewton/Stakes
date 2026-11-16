import { describe, expect, it, vi } from 'vitest';
import {
  getSeedStatusHandler,
  getStakesHandler,
  importCsvHandler,
  previewCsvHandler,
  removeDemoHandler,
  saveSettingsHandler,
  getSettingsHandler,
  seedDemoHandler,
  type HandlerDeps,
} from '../../src/resolvers/handlers.js';
import { EMPTY_SEED_STATUS } from '../../src/adapters/storage.js';
import { readContext } from '../../src/resolvers/context.js';
import { fakeStakesDeps } from '../fakes/deps.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const ctx = { accountId: 'acc-1', cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net/' };

function handlerDeps(opts: { canView?: boolean; admin?: boolean } = {}) {
  const f = fakeStakesDeps();
  const { deps } = f;
  const importer = {
    jira: { canView: vi.fn(async () => true), accountIdForEmail: vi.fn(async () => 'acc') },
    mirror: deps.mirror as never,
    connector: { pushCustomers: vi.fn(), pushDeals: vi.fn() },
    connections: { get: async () => null },
    siteUrl: '',
  };
  const all: HandlerDeps = {
    stakes: deps,
    jira: {
      canView: vi.fn(async () => opts.canView ?? true),
      isAdmin: vi.fn(async () => opts.admin ?? true),
    },
    importer,
    seeder: {
      seed: { status: vi.fn(async () => EMPTY_SEED_STATUS), record: vi.fn(async () => null) },
    } as never,
    settings: {
      jira: {
        isAdmin: vi.fn(async () => opts.admin ?? true),
        priorities: vi.fn(async () => ['Highest', 'High', 'Medium', 'Low', 'Lowest']),
        projects: vi.fn(async () => [{ key: 'PAY', name: 'Orbit Pay', type: 'software' }]),
      },
      settings: f.settings,
      connections: { get: async () => null },
      seed: { status: async () => EMPTY_SEED_STATUS },
    },
  };
  return { all, factory: vi.fn(() => all) };
}

const csv = 'customer_id,customer_name,tier,arr_usd,renewal_date,owner_email\nC1,Acme,SMB,10,,';

describe('readContext', () => {
  it('reads identity from the invocation context and trims the site URL', () => {
    expect(readContext(ctx)).toEqual({
      accountId: 'acc-1',
      cloudId: 'cloud-1',
      siteUrl: 'https://example.atlassian.net',
    });
    expect(readContext(undefined)).toEqual({ accountId: '', cloudId: '', siteUrl: '' });
  });
});

describe('getStakes resolver', () => {
  it('normalises the key, checks access and returns a panel view', async () => {
    const { all, factory } = handlerDeps();
    const result = await getStakesHandler(factory)({ issueKey: ' pay-142 ' }, ctx);
    expect(all.jira.canView).toHaveBeenCalledWith('PAY-142');
    expect(factory).toHaveBeenCalledWith({
      accountId: 'acc-1',
      cloudId: 'cloud-1',
      siteUrl: 'https://example.atlassian.net',
    });
    expect(result).toMatchObject({ ok: true, data: { issueKey: 'PAY-142' } });
  });

  it('rejects a malformed key before any call', async () => {
    const { all, factory } = handlerDeps();
    const result = await getStakesHandler(factory)({ issueKey: 'PAY-1 OR 1=1' }, ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(all.jira.canView).not.toHaveBeenCalled();
  });

  it('answers FORBIDDEN when the user cannot view the issue', async () => {
    const { factory } = handlerDeps({ canView: false });
    expect(await getStakesHandler(factory)({ issueKey: 'PAY-142' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('turns an unexpected exception into INTERNAL without leaking it', async () => {
    const { all, factory } = handlerDeps();
    all.jira.canView = vi.fn().mockRejectedValue(new Error('secret upstream detail'));
    const result = await getStakesHandler(factory)({ issueKey: 'PAY-142' }, ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('CSV resolvers', () => {
  it('only lets Jira admins preview or import', async () => {
    const { factory } = handlerDeps({ admin: false });
    expect(await previewCsvHandler(factory)({ customersCsv: csv }, ctx)).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
    expect(
      await importCsvHandler(factory)({ customersCsv: csv, confirmed: true }, ctx),
    ).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
  });

  it('previews for an admin', async () => {
    const { factory } = handlerDeps();
    const result = await previewCsvHandler(factory)({ customersCsv: csv }, ctx);
    expect(result).toMatchObject({ ok: true, data: { rejected: [], customers: { total: 1 } } });
  });

  it('requires confirmation before importing', async () => {
    const { factory } = handlerDeps();
    expect(await importCsvHandler(factory)({ customersCsv: csv }, ctx)).toMatchObject({
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(
      await importCsvHandler(factory)({ customersCsv: csv, confirmed: true }, ctx),
    ).toMatchObject({
      ok: true,
      data: { customers: 1 },
    });
  });

  it('rejects a payload of the wrong shape', async () => {
    const { factory } = handlerDeps();
    expect(await previewCsvHandler(factory)({ customersCsv: 42 }, ctx)).toMatchObject({
      error: { code: 'INVALID_INPUT', message: expect.stringContaining('customersCsv') },
    });
  });
});

describe('demo seed resolvers', () => {
  it('only lets Jira admins seed, read status or remove', async () => {
    const { factory } = handlerDeps({ admin: false });
    const seed = { softwareProjectKey: 'PAY', serviceProjectKey: 'HELP', confirmed: true };
    expect(await seedDemoHandler(factory)(seed, ctx)).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
    expect(await getSeedStatusHandler(factory)({}, ctx)).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
    expect(await removeDemoHandler(factory)({ confirmed: true }, ctx)).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
  });

  it('validates project keys and requires confirmation', async () => {
    const { factory } = handlerDeps();
    expect(
      await seedDemoHandler(factory)(
        { softwareProjectKey: 'p a y', serviceProjectKey: 'HELP', confirmed: true },
        ctx,
      ),
    ).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
    expect(
      await seedDemoHandler(factory)({ softwareProjectKey: 'pay', serviceProjectKey: 'HELP' }, ctx),
    ).toMatchObject({
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(await removeDemoHandler(factory)({}, ctx)).toMatchObject({
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('returns the stored status to an admin', async () => {
    const { factory } = handlerDeps();
    expect(await getSeedStatusHandler(factory)({}, ctx)).toEqual({
      ok: true,
      data: EMPTY_SEED_STATUS,
    });
  });

  it('reports nothing removed when no demo is loaded', async () => {
    const { factory } = handlerDeps();
    expect(await removeDemoHandler(factory)({ confirmed: true }, ctx)).toMatchObject({
      ok: true,
      data: { state: 'not-loaded' },
    });
  });
});

describe('settings resolvers', () => {
  it('shows settings to anyone who can open the page, flagging admins', async () => {
    const { factory } = handlerDeps({ admin: false });
    expect(await getSettingsHandler(factory)({}, ctx)).toMatchObject({
      ok: true,
      data: { isAdmin: false, connectorConnected: false, settings: { weightsVersion: 1 } },
    });
  });

  it('refuses to save for a non-admin, even when called directly', async () => {
    const { all, factory } = handlerDeps({ admin: false });
    expect(
      await saveSettingsHandler(factory)({ weights: { R: 1, S: 0, C: 0, H: 0, G: 0, U: 0 } }, ctx),
    ).toMatchObject({
      error: { code: 'NOT_ADMIN' },
    });
    expect((await all.settings.settings.get()).weightsVersion).toBe(1);
  });

  it('saves for an admin and rejects malformed input', async () => {
    const { factory } = handlerDeps();
    expect(
      await saveSettingsHandler(factory)({ weights: { R: 1, S: 1, C: 0, H: 0, G: 0, U: 0 } }, ctx),
    ).toMatchObject({
      ok: true,
      data: { weightsVersion: 2, weights: { R: 0.5, S: 0.5 } },
    });
    expect(
      await saveSettingsHandler(factory)({ projectsInScope: ['not a key'] }, ctx),
    ).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  });
});
