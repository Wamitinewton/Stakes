import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));

const { toCustomerOrgObject, toDealObject, summarisePush, makeConnector } =
  await import('../../src/adapters/connector');

const now = new Date('2026-11-12T08:00:00Z');
const site = 'https://example.atlassian.net';

describe('connector object mapping', () => {
  it('maps a customer with its issue associations and lifetime value', () => {
    const obj = toCustomerOrgObject(
      {
        id: 'CUST-007',
        name: 'Kilima Freight',
        tier: 'enterprise',
        arrUsd: 420000,
        renewalDate: '2027-03-31',
        issueKeys: ['PAY-142', 'PAY-118'],
      },
      now,
      site,
    );
    expect(obj).toMatchObject({
      schemaVersion: '2.0',
      id: 'CUST-007',
      displayName: 'Kilima Freight',
      updateSequenceNumber: now.getTime(),
      url: 'https://example.atlassian.net/jira/apps/stakes/customer/CUST-007',
      associations: {
        lastUpdatedAt: '2026-11-12T08:00:00.000Z',
        set: [{ associationType: 'issueIdOrKeys', values: ['PAY-142', 'PAY-118'] }],
      },
      'atlassian:customer-org': {
        customerSegment: 'enterprise',
        customerOrgLifeTimeValue: { value: 420000, currencyCode: 'USD' },
      },
    });
  });

  it('maps a deal with amount, stage and close date, and omits empty associations', () => {
    const obj = toDealObject(
      {
        id: 'DEAL-031',
        name: 'Expansion',
        customerName: 'Kilima Freight',
        amountUsd: 220000,
        stage: 'Negotiation',
        closeDate: '2026-12-15',
        isClosed: false,
        issueKeys: [],
      },
      now,
      site,
    );
    expect(obj.associations).toBeUndefined();
    expect(obj['atlassian:deal']).toEqual({
      stage: 'Negotiation',
      accountName: 'Kilima Freight',
      isClosed: false,
      opportunityAmount: { value: 220000, currencyCode: 'USD' },
      dealClosedAt: '2026-12-15T00:00:00Z',
    });
  });
});

describe('summarisePush', () => {
  it('counts accepted objects and lists rejections by id', () => {
    expect(
      summarisePush(
        {
          success: true,
          results: {
            accepted: [{ entityType: 'atlassian:deal', entityId: { id: 'DEAL-1' } }],
            rejected: [
              {
                key: { entityType: 'atlassian:deal', entityId: { id: 'DEAL-2' } },
                errors: [{ key: 'amount', message: 'invalid value' }],
              },
            ],
          },
        } as never,
        ['DEAL-1', 'DEAL-2'],
      ),
    ).toEqual({ accepted: 1, rejected: [{ id: 'DEAL-2', reason: 'invalid value' }] });
  });

  it('rejects every object when the whole request fails', () => {
    expect(summarisePush({ success: false, error: 'forbidden' }, ['A', 'B'])).toEqual({
      accepted: 0,
      rejected: [
        { id: 'A', reason: 'forbidden' },
        { id: 'B', reason: 'forbidden' },
      ],
    });
  });
});

describe('makeConnector', () => {
  it('pushes with the connection id, logs rejections, and checks existence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = {
      setObjects: vi.fn().mockResolvedValue({ success: false, error: 'nope' }),
      getObjectByExternalId: vi.fn().mockResolvedValue({ success: true, object: { id: 'X' } }),
      deleteObjectsByExternalId: vi.fn(),
    };
    const connector = makeConnector(sdk as never);
    const result = await connector.push([{ id: 'X' } as never], 'conn-1');
    expect(sdk.setObjects).toHaveBeenCalledWith({ objects: [{ id: 'X' }], connectionId: 'conn-1' });
    expect(result.rejected).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('connector rejected object', { id: 'X', reason: 'nope' });
    expect(await connector.exists('atlassian:deal', 'X', 'conn-1')).toBe(true);
  });
});

describe('bulk push and delete', () => {
  const customer = (i: number) => ({
    id: `CUST-${i}`,
    name: `Customer ${i}`,
    tier: 'smb' as const,
    arrUsd: 1000,
    renewalDate: null,
    issueKeys: ['PAY-1'],
  });

  it('pushes 250 objects in three calls, each stamped with the push time', async () => {
    const setObjects = vi.fn(async ({ objects }: { objects: Array<{ id: string }> }) => ({
      success: true,
      results: { accepted: objects.map((o) => ({ entityId: { id: o.id } })), rejected: [] },
    }));
    const sdk = { setObjects, getObjectByExternalId: vi.fn(), deleteObjectsByExternalId: vi.fn() };
    const connector = makeConnector(sdk as never, () => now);
    const result = await connector.pushCustomers(
      Array.from({ length: 250 }, (_, i) => customer(i)),
      'conn-1',
      site,
    );
    expect(setObjects).toHaveBeenCalledTimes(3);
    expect(setObjects.mock.calls.map(([r]) => r.objects.length)).toEqual([100, 100, 50]);
    const first = setObjects.mock.calls[0]![0].objects[0] as unknown as {
      updateSequenceNumber: number;
    };
    expect(first.updateSequenceNumber).toBe(now.getTime());
    expect(result).toEqual({ accepted: 250, rejected: [] });
  });

  it('reports rejected deals by id in the result and the log, never by value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = {
      setObjects: vi.fn().mockResolvedValue({
        success: true,
        results: {
          accepted: [],
          rejected: [{ key: { entityId: { id: 'DEAL-9' } }, errors: [{ message: 'bad stage' }] }],
        },
      }),
      getObjectByExternalId: vi.fn(),
      deleteObjectsByExternalId: vi.fn(),
    };
    const result = await makeConnector(sdk as never, () => now).pushDeals(
      [
        {
          id: 'DEAL-9',
          name: 'Secret Co expansion',
          customerName: 'Secret Co',
          amountUsd: 999999,
          stage: '??',
          closeDate: null,
          isClosed: false,
          issueKeys: ['PAY-1'],
        },
      ],
      'conn-1',
      site,
    );
    expect(result.rejected).toEqual([{ id: 'DEAL-9', reason: 'bad stage' }]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('DEAL-9');
    expect(logged).not.toContain('Secret Co');
    expect(logged).not.toContain('999999');
  });

  it('deletes by external id in chunks and counts failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deleteObjectsByExternalId = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'x' });
    const sdk = { setObjects: vi.fn(), getObjectByExternalId: vi.fn(), deleteObjectsByExternalId };
    const ids = Array.from({ length: 120 }, (_, i) => `D${i}`);
    const result = await makeConnector(sdk as never).deleteObjects('atlassian:deal', ids, 'conn-1');
    expect(deleteObjectsByExternalId).toHaveBeenCalledTimes(2);
    expect(deleteObjectsByExternalId.mock.calls[0]![0]).toMatchObject({
      objectType: 'atlassian:deal',
      connectionId: 'conn-1',
    });
    expect(result).toEqual({ failed: 20 });
  });
});
