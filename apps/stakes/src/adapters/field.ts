import api, { getAppContext, route } from '@forge/api';
import { expectOk, JiraError, type JiraHttp } from './jira';

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

// Jira identifies the field by this type, which differs per environment, so a site with
// two installations has two Stakes Score fields and each app must pick its own.
function ownFieldType(): string {
  const { appAri, environmentAri } = getAppContext();
  return `ari:cloud:ecosystem::extension/${appAri.appId}/${environmentAri.environmentId}/static/${STAKES_SCORE_FIELD_KEY}`;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

export function makeStakesScoreField(
  http: JiraHttp = asAppFieldHttp,
  fieldType: () => string = ownFieldType,
): StakesScoreField {
  let fieldId: Promise<string> | undefined;

  async function findFieldId(): Promise<string> {
    const type = fieldType();
    const fields = await expectOk('jira-fields', await http(route`/rest/api/3/field`));
    const match = (Array.isArray(fields) ? fields : [])
      .map(obj)
      .find((f) => obj(f.schema).custom === type);
    if (typeof match?.id !== 'string') throw new JiraError('jira-stakes-score-field-find', 404);
    return match.id;
  }

  return {
    async set(issueKey, score) {
      // A failed lookup is forgotten, so the next score tries again.
      fieldId ??= findFieldId().catch((e: unknown) => {
        fieldId = undefined;
        throw e;
      });
      const [id, issue] = await Promise.all([
        fieldId,
        http(route`/rest/api/3/issue/${issueKey}?fields=summary`).then((res) =>
          expectOk('jira-issue-id', res),
        ),
      ]);
      // The value endpoint takes numeric issue ids, not keys.
      const res = await http(route`/rest/api/3/app/field/${id}/value`, {
        method: 'PUT',
        body: { updates: [{ issueIds: [Number(obj(issue).id)], value: score }] },
      });
      await expectOk('jira-stakes-score-field-set', res);
    },
  };
}
