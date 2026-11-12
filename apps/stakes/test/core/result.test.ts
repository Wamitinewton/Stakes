import { describe, expect, it } from 'vitest';
import { err, ok } from '../../src/core/result.js';

describe('result', () => {
  it('wraps data', () => {
    expect(ok({ score: 89 })).toEqual({ ok: true, data: { score: 89 } });
  });

  it('wraps an error with its code', () => {
    expect(err('FORBIDDEN', 'No access to PAY-142')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'No access to PAY-142' },
    });
  });
});
