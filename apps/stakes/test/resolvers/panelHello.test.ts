import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('@forge/resolver', () => ({
  default: class {
    define() {}
    getDefinitions() {
      return {};
    }
  },
}));

const { panelHello } = await import('../../src/resolvers/index.js');

describe('panelHello', () => {
  it('greets the issue from the invocation context', () => {
    expect(panelHello({ extension: { issue: { key: 'PAY-142' } } })).toEqual({
      ok: true,
      data: { issueKey: 'PAY-142', message: 'Stakes is installed and can see PAY-142.' },
    });
  });

  it('returns an error value when the issue context is missing or malformed', () => {
    expect(panelHello({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(panelHello({ extension: { issue: { key: 'not a key' } } })).toMatchObject({
      ok: false,
    });
    expect(panelHello(undefined)).toMatchObject({ ok: false });
  });
});

describe('llmCheck', async () => {
  const { llmCheck } = await import('../../src/resolvers/index.js');

  it('returns the completion and any missing models', async () => {
    const llm = {
      complete: vi.fn().mockResolvedValue({
        text: 'ready',
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 20, outputTokens: 1 },
      }),
      missingModels: vi.fn().mockResolvedValue([]),
    };
    const result = await llmCheck(llm);
    expect(result).toMatchObject({ ok: true, data: { text: 'ready', missingModels: [] } });
  });

  it('turns an SDK failure into an error value', async () => {
    const llm = {
      complete: vi.fn().mockRejectedValue(new Error('boom')),
      missingModels: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await llmCheck(llm)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
  });
});
