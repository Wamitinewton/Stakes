import { invoke } from '@forge/bridge';

export type ResolverResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function call<T>(resolver: string, payload: Record<string, unknown>): Promise<T> {
  let result: ResolverResult<T>;
  try {
    result = (await invoke<ResolverResult<T>>(resolver, payload)) as ResolverResult<T>;
  } catch {
    throw new Error('Stakes could not reach its backend. Try again.');
  }
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
