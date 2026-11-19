export type Result<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(code: string, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
