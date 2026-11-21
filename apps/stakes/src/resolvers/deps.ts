import { makeUserAdapters } from '../adapters/index';
import { makeSeedStore, type HistoryStore } from '../adapters/storage';
import type { JiraReader } from '../adapters/jira';
import type { CustomerDeps } from '../services/customers';
import { DEMO_DATA } from '../services/demoData';
import type { BacklogDeps } from '../services/rankBacklog';
import type { ReleaseDeps } from '../services/releaseStakes';
import type { SeedRecord } from '../services/seed';
import type { ShipNoticeDeps } from '../services/shipNotice';
import type { CallContext } from './context';
import type { HandlerDeps } from './handlers';
import { makeWriter } from './textWriter';

export interface UserDeps extends HandlerDeps {
  backlog: BacklogDeps;
  release: ReleaseDeps;
  customers: CustomerDeps;
  shipNotice: ShipNoticeDeps;
  // The full reader and history store, for Rovo actions that need more than one
  // service's slice of them.
  reader: JiraReader;
  historyStore: HistoryStore;
}

// Every resolver runs as the person using the page, so the adapters it builds read
// and write with that person's Jira permissions.
export function userDeps(ctx: CallContext): UserDeps {
  const a = makeUserAdapters(ctx);
  const clock = () => new Date();
  const writer = makeWriter(a);
  const stakes = { ...a, writer, siteUrl: ctx.siteUrl, clock };
  return {
    jira: a.jira,
    stakes,
    priority: { ...a, writer: a.jiraWriter, clock },
    backlog: { ...a, stakes, clock },
    release: a,
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
    llm: a.llm,
    reader: a.jira,
    historyStore: a.history,
    shipNotice: {
      jira: a.jira,
      writer: a.jiraWriter,
      notices: a.notices,
      stakes,
      text: writer,
      siteUrl: ctx.siteUrl,
      clock,
    },
  };
}
