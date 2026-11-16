import { describe, expect, it } from 'vitest';
import { recomputeBatchHandler, listBacklogHandler } from '../../src/resolvers/backlog.js';

const noDeps = () => {
  throw new Error('dependencies should not be built for invalid input');
};

describe('backlog resolver input', () => {
  it('rejects batches over 20 keys', async () => {
    const issueKeys = Array.from({ length: 21 }, (_, index) => `PAY-${index + 1}`);
    const result = await recomputeBatchHandler(noDeps)({ issueKeys }, {});
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it.each([{}, { issueKeys: [] }, { issueKeys: ['not-a-key'] }])(
    'rejects invalid batches %j',
    async (payload) => {
      expect(await recomputeBatchHandler(noDeps)(payload, {})).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    },
  );

  it('validates the project key', async () => {
    expect(await listBacklogHandler(noDeps)({ projectKey: 'PAY; DROP' }, {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});
