import api, { route } from '@forge/api';
import type { ConfluencePageOption } from '@stakes/contracts';

export type ConfluenceRoute = ReturnType<typeof route>;

export interface ConfluenceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ConfluenceHttp = (
  path: ConfluenceRoute,
  init?: { method?: string; body?: unknown },
) => Promise<ConfluenceResponse>;

const request =
  (identity: 'asUser' | 'asApp'): ConfluenceHttp =>
  (path, init) =>
    api[identity]().requestConfluence(path, {
      method: init?.method ?? 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

export const asUserConfluence = request('asUser');
export const asAppConfluence = request('asApp');

export interface ConfluencePage {
  id: string;
  title: string;
}

export interface ConfluenceAdapter {
  isConnected(): Promise<boolean>;
  parentPages(): Promise<ConfluencePageOption[]>;
  createPage(parentPageId: string, title: string, body: string): Promise<ConfluencePage>;
  updatePage(pageId: string, title: string, body: string): Promise<ConfluencePage>;
}

export class ConfluenceError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with HTTP ${status}`);
    this.name = 'ConfluenceError';
  }
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

async function expectOk(operation: string, response: ConfluenceResponse): Promise<unknown> {
  if (!response.ok) throw new ConfluenceError(operation, response.status);
  return response.status === 204 ? null : response.json().catch(() => null);
}

function disconnected(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const status =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : null;
  return (
    name === 'RequestProductNotAllowedError' ||
    name === 'ProductEndpointNotAllowedError' ||
    status === 403 ||
    (error instanceof ConfluenceError && error.status === 404)
  );
}

export function makeConfluence(http: ConfluenceHttp = asUserConfluence): ConfluenceAdapter {
  async function page(pageId: string): Promise<Obj> {
    const response = await http(route`/wiki/api/v2/pages/${pageId}`);
    return obj(await expectOk('confluence-page-read', response));
  }

  return {
    async isConnected() {
      try {
        const response = await http(route`/wiki/api/v2/pages?limit=1`);
        if (response.status === 404) return false;
        await expectOk('confluence-status', response);
        return true;
      } catch (error) {
        if (disconnected(error)) return false;
        throw error;
      }
    },

    async parentPages() {
      const response = await http(route`/wiki/api/v2/pages?limit=100&sort=-modified-date`);
      const body = obj(await expectOk('confluence-page-list', response));
      return (Array.isArray(body.results) ? body.results : [])
        .map(obj)
        .map((p) => ({ id: str(p.id), title: str(p.title) }))
        .filter((p) => p.id !== '' && p.title !== '');
    },

    async createPage(parentPageId, title, body) {
      const parent = await page(parentPageId);
      const response = await http(route`/wiki/api/v2/pages`, {
        method: 'POST',
        body: {
          spaceId: str(parent.spaceId),
          status: 'current',
          title,
          parentId: parentPageId,
          body: { representation: 'storage', value: body },
        },
      });
      const created = obj(await expectOk('confluence-page-create', response));
      return { id: str(created.id), title: str(created.title) || title };
    },

    async updatePage(pageId, title, body) {
      const current = await page(pageId);
      const version = Number(obj(current.version).number);
      const response = await http(route`/wiki/api/v2/pages/${pageId}`, {
        method: 'PUT',
        body: {
          id: pageId,
          spaceId: str(current.spaceId),
          status: 'current',
          title,
          body: { representation: 'storage', value: body },
          version: { number: version + 1, message: 'Updated by Stakes weekly digest' },
        },
      });
      const updated = obj(await expectOk('confluence-page-update', response));
      return { id: str(updated.id) || pageId, title: str(updated.title) || title };
    },
  };
}
