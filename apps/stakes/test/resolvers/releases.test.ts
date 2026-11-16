import { describe, expect, it } from 'vitest';
import { getReleaseStakesHandler } from '../../src/resolvers/releases.js';

const noDeps = () => {
  throw new Error('dependencies should not be built for invalid input');
};

describe('release resolver input', () => {
  it.each([{}, { projectKey: 'PAY; DROP' }, { projectKey: 'PAY', versionId: '2026.12' }])(
    'rejects invalid input %j',
    async (payload) => {
      expect(await getReleaseStakesHandler(noDeps)(payload, {})).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    },
  );
});
