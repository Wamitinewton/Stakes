import Resolver from '@forge/resolver';
import { makeSyncAdapters } from '../adapters/index.js';
import { makeHubspotClient } from '../adapters/hubspot.js';
import { makeSlackClient } from '../adapters/slack.js';
import { makeBridgeStore } from '../adapters/storage.js';
import { makeJiraAdmin } from '../adapters/jira.js';
import { err, ok } from '../core/result.js';
import { getStatus, saveHubspotToken, saveSlackConfig } from '../services/settings.js';
import { syncNow } from '../services/sync.js';

const resolver = new Resolver();
const deps = {
  store: makeBridgeStore(),
  hubspot: makeHubspotClient(),
  slack: makeSlackClient(),
  jira: makeJiraAdmin(),
};

async function requireAdmin() {
  return (await deps.jira.isAdmin()) ? null : err('NOT_ADMIN', 'Only Jira admins can do this');
}

resolver.define('getStatus', async () => {
  const denied = await requireAdmin();
  return denied ?? ok(await getStatus(deps));
});
resolver.define('saveHubspotToken', async ({ payload }) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (payload.confirmed !== true) return err('CONFIRMATION_REQUIRED', 'Confirm saving the token');
  return saveHubspotToken(deps, String(payload.token ?? ''));
});
resolver.define('saveSlackConfig', async ({ payload }) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (payload.confirmed !== true) {
    return err('CONFIRMATION_REQUIRED', 'Confirm saving the Slack configuration');
  }
  return saveSlackConfig(deps, {
    token: String(payload.token ?? ''),
    channel: String(payload.channel ?? ''),
  });
});
resolver.define('syncNow', async ({ payload }) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (payload.confirmed !== true) return err('CONFIRMATION_REQUIRED', 'Confirm the sync first');
  return syncNow(makeSyncAdapters());
});

export const handler = resolver.getDefinitions();
