import { describe, expect, it, vi } from 'vitest';
import { needsConsent } from '../../src/core/consent';
import { err } from '../../src/core/result';
import { guarded } from '../../src/resolvers/context';

vi.spyOn(console, 'error').mockImplementation(() => {});

const consentError = () =>
  Object.assign(new Error('needs consent'), { name: 'NEEDS_AUTHENTICATION_ERR' });

describe('needsConsent', () => {
  it('recognises only the Forge consent error', () => {
    expect(needsConsent(consentError())).toBe(true);
    expect(needsConsent(new Error('boom'))).toBe(false);
    expect(needsConsent('NEEDS_AUTHENTICATION_ERR')).toBe(false);
  });
});

describe('guarded', () => {
  it('rethrows the consent error so Forge shows the access prompt', async () => {
    const e = consentError();
    await expect(
      guarded('seedDemo', async () => {
        throw e;
      }),
    ).rejects.toBe(e);
  });

  it('still turns other errors into an INTERNAL result', async () => {
    const result = await guarded('seedDemo', async () => {
      throw new Error('boom');
    });
    expect(result).toEqual(err('INTERNAL', expect.any(String)));
  });
});
