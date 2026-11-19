import { describe, expect, it, vi } from 'vitest';
import { makeConnector } from '../src/adapters/connector.js';

describe('connector logging', () => {
  it('logs only the rejected count, not upstream reasons or object payloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = {
      setObjects: vi.fn(async () => ({ success: false, error: 'upstream payload detail' })),
      deleteObjectsByExternalId: vi.fn(),
    };
    const connector = makeConnector(sdk as never);

    await connector.pushDeals(
      [
        {
          id: 'DEAL-031',
          name: 'Confidential deal name',
          customerName: 'Confidential customer',
          amountUsd: 220000,
          stage: 'Negotiation',
          closeDate: '2026-12-15',
          isClosed: false,
          issueKeys: ['PAY-142'],
        },
      ],
      'connection-1',
    );

    expect(warn).toHaveBeenCalledWith('connector rejected objects', { count: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('upstream payload detail');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Confidential');
  });
});
