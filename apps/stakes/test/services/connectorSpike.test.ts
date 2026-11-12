import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));

const { runConnectorSpike } = await import('../../src/services/connectorSpike.js');

const deps = (connectionId: string | null) => ({
  connector: {
    push: vi.fn().mockResolvedValue({ accepted: 2, rejected: [] }),
    exists: vi.fn().mockResolvedValue(true),
  },
  connections: { get: vi.fn().mockResolvedValue(connectionId), set: vi.fn(), clear: vi.fn() },
  graph: {
    query: vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { echo: 'stakes' } })
      .mockResolvedValueOnce({ ok: false, degraded: true, reason: 'partial-errors' }),
  },
  clock: () => new Date('2026-11-12T08:00:00Z'),
});

describe('runConnectorSpike', () => {
  it('refuses to push before the connector is connected', async () => {
    const d = deps(null);
    const result = await runConnectorSpike(d, 'PAY-1', 'https://s');
    expect(result).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
    expect(d.connector.push).not.toHaveBeenCalled();
  });

  it('pushes one customer and one deal linked to the issue and reports both read paths', async () => {
    const d = deps('conn-1');
    const result = await runConnectorSpike(d, 'PAY-1', 'https://s');
    const [objects, connectionId] = d.connector.push.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(objects.map((o: { id: string }) => o.id)).toEqual(['CUST-SPIKE', 'DEAL-SPIKE']);
    expect(objects[1].associations.set[0].values).toEqual(['PAY-1']);
    expect(d.graph.query).toHaveBeenCalledWith(
      'stakes_q1_deals',
      expect.stringContaining('customQuery'),
      { queryKey: 'stakes_q1_deals', queryParams: { issueKey: 'PAY-1' } },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        pushed: { accepted: 2, rejected: [] },
        storedInGraph: { customer: true, deal: true },
        api: {
          echo: { ok: true, sample: '{"echo":"stakes"}' },
          dealReadBack: { ok: false, reason: 'partial-errors' },
        },
      },
    });
  });
});
