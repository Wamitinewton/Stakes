// Entry points return errors as values so the UI, Rovo and MCP callers all receive
// the same shape and nothing depends on an exception crossing the Forge bridge.
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_ADMIN'
  | 'CONFIRMATION_REQUIRED'
  | 'STALE_PREVIEW'
  | 'UPSTREAM_DEGRADED'
  | 'INTERNAL';

export type Result<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
