import Resolver from '@forge/resolver';
import { isIssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import { makeLlmClient, type LlmClient } from '../adapters/llm.js';
import { makeConnector } from '../adapters/connector.js';
import { makeConnectionStore } from '../adapters/storage.js';
import { makeGraphClient } from '../adapters/graph.js';
import { runConnectorSpike } from '../services/connectorSpike.js';
import { makeUserAdapters } from '../adapters/index.js';
import { readContext, type CallContext } from './context.js';
import {
  applyPriorityHandler,
  getHistoryHandler,
  getSeedStatusHandler,
  getSettingsHandler,
  saveSettingsHandler,
  getStakesHandler,
  importCsvHandler,
  previewCsvHandler,
  removeDemoHandler,
  seedDemoHandler,
  type HandlerDeps,
} from './handlers.js';
import { DEMO_DATA } from '../services/demoData.js';
import { makeSeedStore } from '../adapters/storage.js';
import type { SeedRecord } from '../services/seed.js';
import type { BacklogDeps } from '../services/rankBacklog.js';
import { listBacklogHandler, recomputeBatchHandler, updatePercentilesHandler } from './backlog.js';
import type { CustomerDeps } from '../services/customers.js';
import { getCustomerExposureHandler, searchCustomersHandler } from './customers.js';

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

export interface UserDeps extends HandlerDeps {
  backlog: BacklogDeps;
  customers: CustomerDeps;
}

// Every resolver runs as the person using the page, so the adapters it builds read
// and write with that person's Jira permissions.
export function userDeps(ctx: CallContext): UserDeps {
  const a = makeUserAdapters(ctx);
  const clock = () => new Date();
  const stakes = { ...a, siteUrl: ctx.siteUrl, clock };
  return {
    jira: a.jira,
    stakes,
    priority: { ...a, writer: a.jiraWriter, clock },
    backlog: { ...a, stakes, clock },
    customers: { jira: a.jira, mirror: a.mirror, snapshots: a.snapshots },
    importer: { ...a, siteUrl: ctx.siteUrl },
    seeder: {
      ...a,
      writer: a.jiraWriter,
      seed: makeSeedStore<SeedRecord>(),
      data: DEMO_DATA,
      siteUrl: ctx.siteUrl,
      clock,
    },
    settings: { ...a, seed: makeSeedStore<SeedRecord>() },
  };
}

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
resolver.define('listBacklog', ({ payload, context }) =>
  listBacklogHandler(userDeps)(payload, context),
);
resolver.define('recomputeBatch', ({ payload, context }) =>
  recomputeBatchHandler(userDeps)(payload, context),
);
resolver.define('updatePercentiles', ({ payload, context }) =>
  updatePercentilesHandler(userDeps)(payload, context),
);
resolver.define('searchCustomers', ({ payload, context }) =>
  searchCustomersHandler(userDeps)(payload, context),
);
resolver.define('getCustomerExposure', ({ payload, context }) =>
  getCustomerExposureHandler(userDeps)(payload, context),
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
resolver.define('saveSettings', ({ payload, context }) =>
  saveSettingsHandler(userDeps)(payload, context),
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
  if (!(await userDeps(ctx).jira.isAdmin()))
    return err('NOT_ADMIN', 'Only Jira admins can run diagnostics');
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
