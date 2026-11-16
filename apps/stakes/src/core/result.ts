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
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

// `details` carries structured context the UI can show, such as every rejected CSV
// row, so a caller never has to parse it out of the message.
export function err<T = never>(code: ErrorCode, message: string, details?: unknown): Result<T> {
  return { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
