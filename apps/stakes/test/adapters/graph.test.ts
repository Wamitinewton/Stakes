import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asUser: vi.fn() } }));

const { classifyGraphResponse, makeGraphClient } = await import('../../src/adapters/graph.js');

describe('classifyGraphResponse', () => {
  it('accepts data with no errors', () => {
    expect(classifyGraphResponse(200, { data: { echo: 'x' } })).toEqual({
      ok: true,
      data: { echo: 'x' },
    });
  });

  it('treats HTTP 200 with an errors array as degraded, keeping partial data', () => {
    expect(classifyGraphResponse(200, { data: { a: 1 }, errors: [{ message: 'scope' }] })).toEqual({
      ok: false,
      degraded: true,
      reason: 'partial-errors',
      data: { a: 1 },
    });
  });

  it('treats an empty answer where links are expected as degraded', () => {
    expect(
      classifyGraphResponse<{ items: unknown[] }>(
        200,
        { data: { items: [] } },
        (d) => d.items.length > 0,
      ),
    ).toMatchObject({ ok: false, reason: 'unexpected-empty' });
  });

  it('treats non-2xx and missing bodies as http errors', () => {
    expect(classifyGraphResponse(500, { data: {} })).toMatchObject({ reason: 'http-error' });
    expect(classifyGraphResponse(200, null)).toMatchObject({ reason: 'http-error' });
    expect(classifyGraphResponse(200, {})).toMatchObject({ reason: 'http-error' });
  });
});

describe('makeGraphClient', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('names the operation and classifies the response', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ data: { echo: 'y' } }) });
    const result = await makeGraphClient(request).query('stakes_spike_echo', 'query {}', {});
    expect(request).toHaveBeenCalledWith('query {}', {}, 'stakes_spike_echo');
    expect(result).toEqual({ ok: true, data: { echo: 'y' } });
  });

  it('turns a thrown request into a degraded read', async () => {
    const request = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await makeGraphClient(request).query('op', 'q', {})).toMatchObject({
      ok: false,
      reason: 'http-error',
    });
  });
});
