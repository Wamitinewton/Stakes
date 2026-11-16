import { invoke } from '@forge/bridge';

export type ResolverResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function call<T>(resolver: string, payload: Record<string, unknown>): Promise<T> {
  const result = (await invoke<ResolverResult<T>>(resolver, payload)) as ResolverResult<T>;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
