import Resolver from '@forge/resolver';

const resolver = new Resolver();

// HubSpot and Slack settings arrive with the sync and delivery features; until then the
// page only confirms the install and states the app's egress position.
resolver.define('getStatus', () => ({
  hubspotConfigured: false,
  slackConfigured: false,
  runsOnAtlassian: false,
}));

export const handler = resolver.getDefinitions();
