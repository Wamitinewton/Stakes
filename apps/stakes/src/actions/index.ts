import { asUserHttp, makeJiraReader } from '../adapters/jira.js';
import { guarded, type CallContext } from '../resolvers/context.js';
import { userDeps } from '../resolvers/deps.js';
import {
  draftCustomerUpdateAction,
  findCustomerExposureAction,
  getIssueStakesAction,
  getReleaseStakesAction,
  getScoreTrendAction,
  rankBacklogAction,
  suggestSprintScopeAction,
  type ActionDeps,
  type ActionResult,
} from './handlers.js';

// Rovo passes the site's cloud id with the inputs (or in the install context) and the
// caller's account in the invocation context. Authorisation never depends on inputs:
// every read goes through Jira as the calling user.
export function readActionContext(
  payload: unknown,
  context: unknown,
): Omit<CallContext, 'siteUrl'> {
  const p = (payload ?? {}) as { context?: { cloudId?: unknown } };
  const c = (context ?? {}) as { principal?: { accountId?: unknown }; installContext?: unknown };
  const fromInstall =
    typeof c.installContext === 'string' ? (c.installContext.split('/').pop() ?? '') : '';
  return {
    accountId: typeof c.principal?.accountId === 'string' ? c.principal.accountId : '',
    cloudId: typeof p.context?.cloudId === 'string' ? p.context.cloudId : fromInstall,
  };
}

// Neither Rovo nor MCP clients send the site address, and links an external assistant
// can open must be absolute, so it is read once per warm function instance.
let siteUrl: Promise<string> | null = null;
const site = () =>
  (siteUrl ??= makeJiraReader('', asUserHttp)
    .baseUrl()
    .catch(() => ''));

async function actionDeps(payload: unknown, context: unknown): Promise<ActionDeps> {
  const base = await site();
  const u = userDeps({ ...readActionContext(payload, context), siteUrl: base });
  return {
    jira: u.reader,
    stakes: u.stakes,
    backlog: u.backlog,
    release: u.release,
    customers: u.customers,
    shipNotice: u.shipNotice,
    settings: u.stakes.settings,
    history: u.historyStore,
    siteUrl: base,
    clock: () => new Date(),
  };
}

const action =
  (name: string, run: (deps: ActionDeps, payload: unknown) => Promise<ActionResult>) =>
  (payload: unknown, context: unknown) =>
    guarded(`action ${name}`, async () => run(await actionDeps(payload, context), payload));

export const getIssueStakes = action('get-issue-stakes', getIssueStakesAction);
export const rankBacklog = action('rank-backlog', rankBacklogAction);
export const findCustomerExposure = action('find-customer-exposure', findCustomerExposureAction);
export const getReleaseStakes = action('get-release-stakes', getReleaseStakesAction);
export const draftCustomerUpdate = action('draft-customer-update', draftCustomerUpdateAction);
export const getScoreTrend = action('get-score-trend', getScoreTrendAction);
export const suggestSprintScope = action('suggest-sprint-scope', suggestSprintScopeAction);
