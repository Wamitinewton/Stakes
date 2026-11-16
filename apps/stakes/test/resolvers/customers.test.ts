import { describe, expect, it } from 'vitest';
import {
  getCustomerExposureHandler,
  searchCustomersHandler,
} from '../../src/resolvers/customers.js';

const noDeps = () => {
  throw new Error('dependencies should not be built for invalid input');
};

describe('customer resolver input', () => {
  it.each([{}, { query: '' }, { query: '   ' }])('rejects invalid search %j', async (payload) => {
    expect(await searchCustomersHandler(noDeps)(payload, {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('rejects an empty customer id', async () => {
    expect(await getCustomerExposureHandler(noDeps)({ customerId: ' ' }, {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});
