import { describe, expect, it, vi } from 'vitest';

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
