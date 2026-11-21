import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, forgeApiMock } from '../fakes/jira';

vi.mock('@forge/api', () => forgeApiMock());

const { makeConfluence } = await import('../../src/adapters/confluence');

describe('Confluence adapter', () => {
  it('checks availability and lists parent page choices', async () => {
    const { http } = fakeHttp({
      'GET /wiki/api/v2/pages?limit=1': { status: 200, body: { results: [] } },
      'GET /wiki/api/v2/pages?limit=100&sort=-modified-date': {
        status: 200,
        body: {
          results: [
            { id: '100', title: 'Team updates' },
            { id: '', title: 'Bad' },
          ],
        },
      },
    });
    const confluence = makeConfluence(http);
    expect(await confluence.isConnected()).toBe(true);
    expect(await confluence.parentPages()).toEqual([{ id: '100', title: 'Team updates' }]);
  });

  it('reports an unavailable Confluence product as disconnected', async () => {
    const { http } = fakeHttp({});
    expect(await makeConfluence(http).isConnected()).toBe(false);

    const productNotAllowed = Object.assign(new Error('Confluence is not installed'), {
      name: 'REQUEST_EGRESS_ALLOWLIST_ERR',
      status: 403,
    });
    const request = vi.fn().mockRejectedValue(productNotAllowed);
    expect(await makeConfluence(request).isConnected()).toBe(false);
  });

  it('creates under the parent and updates with the next version', async () => {
    const { http, calls } = fakeHttp({
      'GET /wiki/api/v2/pages/100': { status: 200, body: { id: '100', spaceId: 'space-1' } },
      'POST /wiki/api/v2/pages': {
        status: 200,
        body: { id: '200', title: 'Stakes weekly digest' },
      },
      'GET /wiki/api/v2/pages/200': {
        status: 200,
        body: { id: '200', spaceId: 'space-1', version: { number: 3 } },
      },
      'PUT /wiki/api/v2/pages/200': {
        status: 200,
        body: { id: '200', title: 'Stakes weekly digest' },
      },
    });
    const confluence = makeConfluence(http);
    expect(await confluence.createPage('100', 'Stakes weekly digest', '<p>Intro</p>')).toEqual({
      id: '200',
      title: 'Stakes weekly digest',
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: {
        spaceId: 'space-1',
        parentId: '100',
        body: { representation: 'storage', value: '<p>Intro</p>' },
      },
    });

    await confluence.updatePage('200', 'Stakes weekly digest', '<p>Updated</p>');
    expect(calls[3]).toMatchObject({
      method: 'PUT',
      path: '/wiki/api/v2/pages/200',
      body: {
        id: '200',
        spaceId: 'space-1',
        version: { number: 4, message: 'Updated by Stakes weekly digest' },
        body: { representation: 'storage', value: '<p>Updated</p>' },
      },
    });
  });
});
