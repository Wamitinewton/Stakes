import { z } from 'zod';
import type { CustomerSearch, CustomerView } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result';
import { getCustomerExposure, searchCustomers, type CustomerDeps } from '../services/customers';
import { guarded, parseInput, readContext, type CallContext } from './context';

export type CustomerDepsFactory = (ctx: CallContext) => { customers: CustomerDeps };

const SearchInput = z.object({ query: z.string().trim().min(1).max(100) });
const ExposureInput = z.object({ customerId: z.string().trim().min(1).max(100) });

export function searchCustomersHandler(makeDeps: CustomerDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<CustomerSearch>> =>
    guarded('searchCustomers', async () => {
      const parsed = parseInput(SearchInput, payload);
      if (!parsed.ok) return parsed;
      return ok(await searchCustomers(makeDeps(readContext(context)).customers, parsed.data.query));
    });
}

export function getCustomerExposureHandler(makeDeps: CustomerDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<CustomerView>> =>
    guarded('getCustomerExposure', async () => {
      const parsed = parseInput(ExposureInput, payload);
      if (!parsed.ok) return parsed;
      const exposure = await getCustomerExposure(
        makeDeps(readContext(context)).customers,
        parsed.data.customerId,
      );
      return exposure
        ? ok(exposure)
        : err('NOT_FOUND', 'Customer not found. Search again or check the CRM mirror.');
    });
}
