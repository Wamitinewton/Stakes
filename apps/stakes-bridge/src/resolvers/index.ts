import Resolver from '@forge/resolver';
import { makeSyncAdapters } from '../adapters/index.js';
import { makeHubspotClient } from '../adapters/hubspot.js';
import { makeSlackClient } from '../adapters/slack.js';
import { makeBridgeStore } from '../adapters/storage.js';
import { ok } from '../core/result.js';
import { getStatus, saveHubspotToken, saveSlackConfig } from '../services/settings.js';
import { syncNow } from '../services/sync.js';

const resolver = new Resolver();
const deps = {
  store: makeBridgeStore(),
  hubspot: makeHubspotClient(),
  slack: makeSlackClient(),
};

resolver.define('getStatus', async () => ok(await getStatus(deps)));
resolver.define('saveHubspotToken', ({ payload }) =>
  saveHubspotToken(deps, String(payload.token ?? '')),
);
resolver.define('saveSlackConfig', ({ payload }) =>
  saveSlackConfig(deps, {
    token: String(payload.token ?? ''),
    channel: String(payload.channel ?? ''),
  }),
);
resolver.define('syncNow', () => syncNow(makeSyncAdapters()));

export const handler = resolver.getDefinitions();
