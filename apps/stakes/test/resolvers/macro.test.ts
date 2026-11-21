import { describe, expect, it } from 'vitest';
import { macroTableHandler } from '../../src/resolvers/macro';

const noDeps = () => {
  throw new Error('dependencies should not be built for invalid input');
};

describe('macro resolver input', () => {
  it.each([
    {},
    { mode: 'project' },
    { mode: 'other', key: 'PAY' },
    { mode: 'project', key: 'PAY; DROP' },
    { mode: 'version', key: 'PAY' },
    { mode: 'version', key: 'PAY:' },
    { mode: 'version', key: ':2026.12' },
    { mode: 'customer', key: ' ' },
  ])('rejects invalid input %j', async (payload) => {
    expect(await macroTableHandler(noDeps)(payload, {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});
