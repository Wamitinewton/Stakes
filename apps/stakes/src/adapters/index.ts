import { makeConnector } from './connector.js';
import { makeStakesScoreField } from './field.js';
import { appContextGraphReader, makeGraphClient, makeGraphReader } from './graph.js';
import { asAppHttp, asUserHttp, makeJiraReader } from './jira.js';
import { makeJiraWriter } from './jiraWriter.js';
import { makeSprintAdapter } from './sprint.js';
import {
  makeAuditStore,
  makeConnectionStore,
  makeHistoryStore,
  makeLlmStore,
  makeMirrorStore,
  makePercentileStore,
  makeSeedStore,
  makeSettingsStore,
  makeShipNoticeStore,
  makeSnapshotStore,
} from './storage.js';

export interface AdapterContext {
  siteUrl: string;
  cloudId: string;
}

function shared() {
  return {
    connector: makeConnector(),
    mirror: makeMirrorStore(),
    snapshots: makeSnapshotStore(),
    history: makeHistoryStore(),
    audit: makeAuditStore(),
    settings: makeSettingsStore(),
    percentiles: makePercentileStore(),
    connections: makeConnectionStore(),
    seed: makeSeedStore<unknown>(),
    scoreField: makeStakesScoreField(),
    llm: makeLlmStore(),
    notices: makeShipNoticeStore(),
  };
}

// The entry point decides whose identity every adapter uses. User context gets the
// graph and general Jira writes; app context gets neither, apart from the app-owned
// score field. Its graph reader throws, so a trigger that tries to read the graph fails
// loudly instead of silently reading nothing.
export function makeUserAdapters(ctx: AdapterContext) {
  return {
    ...shared(),
    jira: makeJiraReader(ctx.siteUrl, asUserHttp),
    jiraWriter: makeJiraWriter(asUserHttp),
    sprints: makeSprintAdapter(ctx.siteUrl, asUserHttp),
    graph: makeGraphReader(makeGraphClient(), ctx.cloudId),
  };
}

export function makeAppAdapters(ctx: AdapterContext) {
  return {
    ...shared(),
    jira: makeJiraReader(ctx.siteUrl, asAppHttp),
    graph: appContextGraphReader(),
  };
}

export function makeAdapters(
  opts: { as: 'user' } & AdapterContext,
): ReturnType<typeof makeUserAdapters>;
export function makeAdapters(
  opts: { as: 'app' } & AdapterContext,
): ReturnType<typeof makeAppAdapters>;
export function makeAdapters(opts: { as: 'user' | 'app' } & AdapterContext) {
  return opts.as === 'user' ? makeUserAdapters(opts) : makeAppAdapters(opts);
}
