import { z } from 'zod';
import { err, ok, type Result } from '../core/result';
import { needsConsent } from '../core/consent';

export interface CallContext {
  accountId: string;
  cloudId: string;
  siteUrl: string;
}

// Forge passes who is calling and from which site in the invocation context. It is
// never taken from the payload, which the browser controls.
export function readContext(context: unknown): CallContext {
  const c = (context ?? {}) as { accountId?: unknown; cloudId?: unknown; siteUrl?: unknown };
  return {
    accountId: typeof c.accountId === 'string' ? c.accountId : '',
    cloudId: typeof c.cloudId === 'string' ? c.cloudId : '',
    siteUrl: typeof c.siteUrl === 'string' ? c.siteUrl.replace(/\/$/, '') : '',
  };
}

export function parseInput<T>(schema: z.ZodType<T>, payload: unknown): Result<T> {
  const parsed = schema.safeParse(payload ?? {});
  if (parsed.success) return ok(parsed.data);
  const first = parsed.error.issues[0];
  const field = first?.path.findLast((part) => typeof part === 'string');
  return err(
    'INVALID_INPUT',
    `Invalid ${typeof field === 'string' ? field : 'input'}. Check the value and try again.`,
  );
}

// Errors reach the UI as values. An unexpected exception is logged by name only and
// returned as INTERNAL, so no stack trace or upstream message leaks to the browser.
export async function guarded<T>(name: string, work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (e) {
    if (needsConsent(e)) throw e;
    console.error('resolver failed', {
      resolver: name,
      error: e instanceof Error ? e.name : 'unknown',
    });
    return err(
      'INTERNAL',
      'Stakes hit an unexpected problem. Try again. If it keeps failing, contact a Jira admin.',
    );
  }
}

export const Confirmed = z.object({ confirmed: z.literal(true) });
