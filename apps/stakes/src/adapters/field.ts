import api, { route } from '@forge/api';
import { expectOk, type JiraHttp } from './jira';

export const STAKES_SCORE_FIELD_KEY = 'stakes-score-field';

export interface StakesScoreField {
  set(issueKey: string, score: number): Promise<void>;
}

const asAppFieldHttp: JiraHttp = (path, init) =>
  api.asApp().requestJira(path, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

export function makeStakesScoreField(http: JiraHttp = asAppFieldHttp): StakesScoreField {
  return {
    async set(issueKey, score) {
      const res = await http(route`/rest/api/3/app/field/${STAKES_SCORE_FIELD_KEY}/value`, {
        method: 'PUT',
        body: { issueIdOrKey: issueKey, value: score },
      });
      await expectOk('jira-stakes-score-field-set', res);
    },
  };
}
