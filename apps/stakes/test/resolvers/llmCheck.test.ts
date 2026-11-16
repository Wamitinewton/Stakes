import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('@forge/api', () => ({ default: { asUser: vi.fn(), asApp: vi.fn() }, route: vi.fn() }));
vi.mock('@forge/kvs', () => ({ kvs: { entity: () => ({}) }, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));
vi.mock('@forge/resolver', () => ({
  default: class {
    define() {}
    getDefinitions() {
      return {};
    }
  },
}));

const { llmCheck } = await import('../../src/resolvers/index.js');

describe('llmCheck', () => {
  it('reports the model reply and any missing models', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const llm = {
      complete: vi
        .fn()
        .mockResolvedValue({
          text: 'ready',
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      missingModels: vi.fn().mockResolvedValue([]),
    };
    expect(await llmCheck(llm)).toEqual({
      ok: true,
      data: {
        text: 'ready',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
        missingModels: [],
      },
    });
  });

  it('turns a failed call into a degraded result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm = { complete: vi.fn().mockRejectedValue(new Error('x')), missingModels: vi.fn() };
    expect(await llmCheck(llm)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
  });
});
