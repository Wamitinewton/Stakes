import { describe, expect, it, vi } from 'vitest';
import { fakeHttp, forgeApiMock } from '../fakes/jira.js';

vi.mock('@forge/api', () => forgeApiMock());

const { makeStakesScoreField } = await import('../../src/adapters/field.js');

describe('Stakes Score field', () => {
  it('sets the app field value for an issue', async () => {
    const { http, calls } = fakeHttp({
      'PUT /rest/api/3/app/field/stakes-score-field/value': { status: 204 },
    });

    await makeStakesScoreField(http).set('PAY-142', 89);

    expect(calls).toEqual([
      {
        method: 'PUT',
        path: '/rest/api/3/app/field/stakes-score-field/value',
        body: { issueIdOrKey: 'PAY-142', value: 89 },
      },
    ]);
  });

  it('surfaces a Jira error when the value cannot be set', async () => {
    const { http } = fakeHttp({
      'PUT /rest/api/3/app/field/stakes-score-field/value': { status: 400 },
    });

    await expect(makeStakesScoreField(http).set('PAY-142', 89)).rejects.toThrow(
      'jira-stakes-score-field-set failed with HTTP 400',
    );
  });
});
