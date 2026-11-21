import { describe, expect, it, vi } from 'vitest';
import { importCsv, previewCsv } from '../../src/services/importCsv';
import { makeMirrorStore } from '../../src/adapters/storage';
import { fakeKvs } from '../fakes/kvs';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

const customersCsv = [
  'customer_id,customer_name,tier,arr_usd,renewal_date,owner_email',
  'CUST-007,Kilima Freight,Enterprise,420000,2027-03-31,owner@example.com',
  'CUST-012,Savanna Health,Enterprise,300000,,',
].join('\n');
const dealsCsv = [
  'deal_id,deal_name,customer_id,amount_usd,stage,probability,close_date,deal_owner_email,blocked_by_issues',
  'DEAL-031,Expansion,CUST-007,220000,Negotiation,0.6,2026-12-15,owner@example.com,PAY-142;PAY-118',
  'DEAL-034,Claims export,CUST-012,160000,Closed Won,90,2027-01-20,,PAY-142',
].join('\n');

function deps(
  opts: { connected?: boolean; missingKeys?: string[]; unknownEmails?: string[] } = {},
) {
  const store = fakeKvs();
  const mirror = makeMirrorStore(store.kvs);
  const connector = {
    pushCustomers: vi.fn(async (c: unknown[]) => ({ accepted: c.length, rejected: [] })),
    pushDeals: vi.fn(async () => ({ accepted: 1, rejected: [{ id: 'DEAL-034', reason: 'x' }] })),
  };
  const jira = {
    canView: vi.fn(async (k: string) => !(opts.missingKeys ?? []).includes(k)),
    accountIdForEmail: vi.fn(async (e: string) =>
      (opts.unknownEmails ?? []).includes(e) ? null : 'acc-owner-1',
    ),
  };
  return {
    d: {
      jira,
      mirror,
      connector,
      connections: { get: async () => (opts.connected === false ? null : 'conn-1') },
      siteUrl: 'https://example.atlassian.net',
    },
    mirror,
    connector,
    jira,
  };
}

describe('previewCsv', () => {
  it('shows the first rows in column order and no rejections for a clean file', () => {
    const preview = previewCsv({ dealsCsv });
    expect(preview.customers).toBeNull();
    expect(preview.deals).toMatchObject({
      total: 2,
      columns: expect.arrayContaining(['deal_id', 'blocked_by_issues']),
    });
    expect(preview.deals!.rows[0]![0]).toBe('DEAL-031');
    expect(preview.rejected).toEqual([]);
  });

  it('caps the preview at 10 rows and lists every rejection', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `C${i},Name,SMB,${i === 3 ? '-1' : '1'},,`);
    const preview = previewCsv({ customersCsv: [customersCsv.split('\n')[0], ...rows].join('\n') });
    expect(preview.customers!.rows).toHaveLength(10);
    expect(preview.customers!.total).toBe(12);
    expect(preview.rejected).toEqual([
      { file: 'customers', row: 5, reason: 'arr_usd must not be negative' },
    ]);
  });
});

describe('importCsv', () => {
  it('writes the mirror with account ids, pushes to the graph and bumps the deals version', async () => {
    const { d, mirror, connector } = deps();
    const result = await importCsv(d, { customersCsv, dealsCsv });
    expect(result).toEqual({
      ok: true,
      data: { customers: 2, deals: 2, rejected: [], pushedToGraph: true, connectorRejected: 1 },
    });
    const deals = await mirror.dealsForIssue('PAY-142');
    expect(deals.map((x) => [x.id, x.closed, x.ownerAccountId, x.source]).sort()).toEqual([
      ['DEAL-031', false, 'acc-owner-1', 'csv'],
      ['DEAL-034', true, null, 'csv'],
    ]);
    expect(JSON.stringify(await mirror.customersByIds(['CUST-007']))).not.toContain(
      'owner@example.com',
    );
    const pushedCustomers = connector.pushCustomers.mock.calls[0]![0] as Array<{
      id: string;
      issueKeys: string[];
    }>;
    expect(pushedCustomers.find((c) => c.id === 'CUST-007')!.issueKeys).toEqual([
      'PAY-142',
      'PAY-118',
    ]);
    expect(await mirror.dealsVersion()).toBe(1);
  });

  it('imports into the mirror alone when the connector is not connected', async () => {
    const { d, connector } = deps({ connected: false });
    const result = await importCsv(d, { customersCsv, dealsCsv });
    expect(result).toMatchObject({ ok: true, data: { pushedToGraph: false } });
    expect(connector.pushDeals).not.toHaveBeenCalled();
  });

  it('rejects unknown issues, unknown owners and unknown customers, importing nothing', async () => {
    const { d, mirror } = deps({ missingKeys: ['PAY-118'], unknownEmails: ['owner@example.com'] });
    const orphan = `${dealsCsv}\nDEAL-099,Orphan,CUST-404,1000,Proposal,0.4,,,PAY-142`;
    const result = await importCsv(d, { customersCsv, dealsCsv: orphan });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Some rows have problems; nothing was imported',
        details: [
          {
            file: 'customers',
            row: 2,
            reason: 'owner_email owner@example.com is not a Jira user on this site',
          },
          {
            file: 'deals',
            row: 2,
            reason:
              'deal_owner_email owner@example.com is not a Jira user on this site; PAY-118 does not exist or you cannot see it',
          },
          {
            file: 'deals',
            row: 4,
            reason: 'customer_id CUST-404 is not in the customers file or already imported',
          },
        ],
      },
    });
    expect(await mirror.dealsForIssue('PAY-142')).toEqual([]);
    expect(await mirror.dealsVersion()).toBe(0);
  });

  it('accepts deals for a customer imported earlier', async () => {
    const { d } = deps();
    await importCsv(d, { customersCsv });
    const result = await importCsv(d, { dealsCsv });
    expect(result).toMatchObject({ ok: true, data: { deals: 2, customers: 0 } });
  });

  it('returns parse rejections without calling Jira', async () => {
    const { d, jira } = deps();
    const result = await importCsv(d, { customersCsv: 'customer_id\nC1' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT', details: [{ row: 1 }] },
    });
    expect(jira.canView).not.toHaveBeenCalled();
  });

  it('looks each issue key and email up once', async () => {
    const { d, jira } = deps();
    await importCsv(d, { customersCsv, dealsCsv });
    expect(jira.canView).toHaveBeenCalledTimes(2);
    expect(jira.accountIdForEmail).toHaveBeenCalledTimes(1);
  });
});
