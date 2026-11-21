import Resolver from '@forge/resolver';
import { isIssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result';
import { makeLlmClient, type LlmClient } from '../adapters/llm';
import { makeConnector } from '../adapters/connector';
import { makeConnectionStore } from '../adapters/storage';
import { makeGraphClient } from '../adapters/graph';
import { runConnectorSpike } from '../services/connectorSpike';
import { readContext } from './context';
import { userDeps } from './deps';
import {
  dismissShipNoticeHandler,
  draftCustomerUpdateHandler,
  getShipNoticeHandler,
  sendShipNoticeHandler,
} from './shipNotice';
import {
  applyPriorityHandler,
  getBadgeHandler,
  getHistoryHandler,
  getLlmUsageHandler,
  getSeedStatusHandler,
  getSettingsHandler,
  saveSettingsHandler,
  getStakesHandler,
  importCsvHandler,
  previewCsvHandler,
  removeDemoHandler,
  seedDemoHandler,
} from './handlers';
import { listBacklogHandler, recomputeBatchHandler, updatePercentilesHandler } from './backlog';
import { getReleaseStakesHandler } from './releases';
import { getCustomerExposureHandler, searchCustomersHandler } from './customers';
import { runDigestNowHandler } from './digest';
import { applySprintPlanHandler, planSprintHandler, sprintOptionsHandler } from './sprint';
import { macroTableHandler } from './macro';

export interface LlmCheck {
  text: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  missingModels: string[];
}

// A fixed, evidence-free prompt: it proves the Forge LLM path works end to end on the
// site without sending any issue data to the model.
export async function llmCheck(llm: LlmClient): Promise<Result<LlmCheck>> {
  try {
    const [completion, missingModels] = await Promise.all([
      llm.complete({
        model: 'haiku',
        system: 'You answer with exactly one word.',
        user: 'Reply with the word: ready',
        maxTokens: 10,
      }),
      llm.missingModels(),
    ]);
    console.log('llm-check ok', {
      model: completion.model,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      missingModels: missingModels.length,
    });
    return ok({ ...completion, missingModels });
  } catch (e) {
    console.error('llm-check failed', { name: e instanceof Error ? e.name : 'unknown' });
    return err('UPSTREAM_DEGRADED', 'The Forge LLM call failed; see forge logs.');
  }
}

export { userDeps, type UserDeps } from './deps';

const resolver = new Resolver();

resolver.define('getStakes', ({ payload, context }) =>
  getStakesHandler(userDeps)(payload, context),
);
resolver.define('applyPriority', ({ payload, context }) =>
  applyPriorityHandler(userDeps)(payload, context),
);
resolver.define('getHistory', ({ payload, context }) =>
  getHistoryHandler(userDeps)(payload, context),
);
resolver.define('getShipNotice', ({ payload, context }) =>
  getShipNoticeHandler(userDeps)(payload, context),
);
resolver.define('draftCustomerUpdate', ({ payload, context }) =>
  draftCustomerUpdateHandler(userDeps)(payload, context),
);
resolver.define('sendShipNotice', ({ payload, context }) =>
  sendShipNoticeHandler(userDeps)(payload, context),
);
resolver.define('dismissShipNotice', ({ payload, context }) =>
  dismissShipNoticeHandler(userDeps)(payload, context),
);
resolver.define('getBadge', ({ payload, context }) => getBadgeHandler(userDeps)(payload, context));
resolver.define('listBacklog', ({ payload, context }) =>
  listBacklogHandler(userDeps)(payload, context),
);
resolver.define('recomputeBatch', ({ payload, context }) =>
  recomputeBatchHandler(userDeps)(payload, context),
);
resolver.define('updatePercentiles', ({ payload, context }) =>
  updatePercentilesHandler(userDeps)(payload, context),
);
resolver.define('getReleaseStakes', ({ payload, context }) =>
  getReleaseStakesHandler(userDeps)(payload, context),
);
resolver.define('searchCustomers', ({ payload, context }) =>
  searchCustomersHandler(userDeps)(payload, context),
);
resolver.define('getCustomerExposure', ({ payload, context }) =>
  getCustomerExposureHandler(userDeps)(payload, context),
);
resolver.define('sprintOptions', ({ payload, context }) =>
  sprintOptionsHandler(userDeps)(payload, context),
);
resolver.define('planSprint', ({ payload, context }) =>
  planSprintHandler(userDeps)(payload, context),
);
resolver.define('applySprintPlan', ({ payload, context }) =>
  applySprintPlanHandler(userDeps)(payload, context),
);
resolver.define('macroTable', ({ payload, context }) =>
  macroTableHandler(userDeps)(payload, context),
);
resolver.define('previewCsv', ({ payload, context }) =>
  previewCsvHandler(userDeps)(payload, context),
);
resolver.define('importCsv', ({ payload, context }) =>
  importCsvHandler(userDeps)(payload, context),
);
resolver.define('seedDemo', ({ payload, context }) => seedDemoHandler(userDeps)(payload, context));
resolver.define('getSeedStatus', ({ payload, context }) =>
  getSeedStatusHandler(userDeps)(payload, context),
);
resolver.define('removeDemo', ({ payload, context }) =>
  removeDemoHandler(userDeps)(payload, context),
);

resolver.define('getSettings', ({ payload, context }) =>
  getSettingsHandler(userDeps)(payload, context),
);
resolver.define('getLlmUsage', ({ payload, context }) =>
  getLlmUsageHandler(userDeps)(payload, context),
);
resolver.define('saveSettings', ({ payload, context }) =>
  saveSettingsHandler(userDeps)(payload, context),
);
resolver.define('runDigestNow', ({ payload, context }) =>
  runDigestNowHandler(userDeps)(payload, context),
);
// Diagnostics for the CRM read-path spike, run from the settings page by an admin. The
// LLM check sends a fixed prompt with no issue data.
resolver.define('llmCheck', async ({ context }) => {
  const deps = userDeps(readContext(context));
  if (!(await deps.jira.isAdmin())) return err('NOT_ADMIN', 'Only Jira admins can run diagnostics');
  return llmCheck(makeLlmClient());
});
resolver.define('connectorSpike', async ({ payload, context }) => {
  const ctx = readContext(context);
  const raw = (payload as { issueKey?: unknown } | undefined)?.issueKey;
  const issueKey = typeof raw === 'string' ? raw.trim().toUpperCase() : raw;
  if (!isIssueKey(issueKey)) return err('INVALID_INPUT', 'Enter an issue key like PAY-142');
  const deps = userDeps(ctx);
  if (!(await deps.jira.isAdmin())) return err('NOT_ADMIN', 'Only Jira admins can run diagnostics');
  if ((payload as { confirmed?: unknown } | undefined)?.confirmed !== true) {
    return err('CONFIRMATION_REQUIRED', 'Confirm the connector check first');
  }
  if (!(await deps.jira.canView(issueKey))) {
    return err('FORBIDDEN', `You don't have access to ${issueKey}`);
  }
  return runConnectorSpike(
    {
      connector: makeConnector(),
      connections: makeConnectionStore(),
      graph: makeGraphClient(),
      clock: () => new Date(),
    },
    issueKey,
    ctx.siteUrl,
  );
});

export const handler = resolver.getDefinitions();
