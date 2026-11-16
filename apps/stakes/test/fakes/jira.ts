import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { JiraHttp } from '../../src/adapters/jira.js';

export const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/jira/${name}.json`, import.meta.url), 'utf8'));

type Reply = { status: number; body?: unknown };

// Answers "METHOD /path" with the first route whose pattern is a prefix of the request
// (query string included), and records every call for assertions.
export function fakeHttp(routes: Record<string, Reply | ((body: unknown) => Reply)>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const http = vi.fn(async (path: unknown, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    const p = String(path);
    calls.push({ method, path: p, body: init?.body });
    const match = Object.entries(routes)
      .filter(([pattern]) => `${method} ${p}`.startsWith(pattern))
      .sort(([a], [b]) => b.length - a.length)[0];
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    const reply = typeof match[1] === 'function' ? match[1](init?.body) : match[1];
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
    };
  });
  return { http: http as unknown as JiraHttp, calls };
}

// `route` from @forge/api, reduced to plain string interpolation with the same escaping.
export const forgeApiMock = () => ({
  default: { asUser: vi.fn() },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''),
      '',
    ),
});
