import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, forgeApiMock } from '../fakes/jira';

vi.mock('@forge/api', () => forgeApiMock());

const { makeStakesScoreField } = await import('../../src/adapters/field');

const TYPE = 'ari:cloud:ecosystem::extension/app/env/static/stakes-score-field';
const routes = {
  'GET /rest/api/3/field': {
    status: 200,
    body: [
      { id: 'customfield_1', schema: { custom: TYPE.replace('/env/', '/other/') } },
      { id: 'customfield_2', schema: { custom: TYPE } },
    ],
  },
  'GET /rest/api/3/issue/PAY-142': { status: 200, body: { id: '10042' } },
};

describe('Stakes Score field', () => {
  it("sets the value on this environment's field by numeric issue id", async () => {
    const { http, calls } = fakeHttp({
      ...routes,
      'PUT /rest/api/3/app/field/customfield_2/value': { status: 204 },
    });

    await makeStakesScoreField(http, () => TYPE).set('PAY-142', 89);

    expect(calls.at(-1)).toEqual({
      method: 'PUT',
      path: '/rest/api/3/app/field/customfield_2/value',
      body: { updates: [{ issueIds: [10042], value: 89 }] },
    });
  });

  it('surfaces a Jira error when the value cannot be set', async () => {
    const { http } = fakeHttp({
      ...routes,
      'PUT /rest/api/3/app/field/customfield_2/value': { status: 400 },
    });

    await expect(makeStakesScoreField(http, () => TYPE).set('PAY-142', 89)).rejects.toThrow(
      'jira-stakes-score-field-set failed with HTTP 400',
    );
  });

  it('fails when the field is not on the site', async () => {
    const { http } = fakeHttp({ ...routes, 'GET /rest/api/3/field': { status: 200, body: [] } });

    await expect(makeStakesScoreField(http, () => TYPE).set('PAY-142', 89)).rejects.toThrow(
      'jira-stakes-score-field-find',
    );
  });
});
