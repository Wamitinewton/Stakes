import { makeConnector } from './connector.js';
import { makeHubspotClient } from './hubspot.js';
import { makeJiraBridge } from './jira.js';
import { makeSlackClient } from './slack.js';
import { makeBridgeStore } from './storage.js';

export function makeSyncAdapters() {
  return {
    store: makeBridgeStore(),
    hubspot: makeHubspotClient(),
    connector: makeConnector(),
    jira: makeJiraBridge(),
    clock: () => new Date(),
  };
}

export function makeDeliveryAdapters() {
  return {
    store: makeBridgeStore(),
    jira: makeJiraBridge(),
    slack: makeSlackClient(),
    clock: () => new Date(),
  };
}
