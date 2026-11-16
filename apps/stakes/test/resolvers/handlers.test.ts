import { describe, expect, it, vi } from 'vitest';
import {
  getStakesHandler,
  importCsvHandler,
  previewCsvHandler,
  type HandlerDeps,
} from '../../src/resolvers/handlers.js';
import { readContext } from '../../src/resolvers/context.js';
import { fakeStakesDeps } from '../fakes/deps.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const ctx = { accountId: 'acc-1', cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net/' };

function handlerDeps(opts: { canView?: boolean; admin?: boolean } = {}) {
  const { deps } = fakeStakesDeps();
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
