import {
  makeAuditStore,
  makeConnectionStore,
  makeHistoryStore,
  makeLlmStore,
  makeShipNoticeStore,
} from '../adapters/storage.js';
import { makeAppAdapters } from '../adapters/index.js';
import { nightlyMaintenance } from '../services/maintenance.js';
import {
  onIssueUpdated as handleIssueUpdated,
  onVersionReleased as handleVersionReleased,
  type CreateNoticeDeps,
  type IssueUpdatedEvent,
  type VersionReleasedEvent,
} from '../services/shipNotice.js';
import { makeWriter } from '../resolvers/textWriter.js';

// Product events run as the app: they may read Jira and storage and save a pending
// notice, but they never read the graph or post anything people see. The site URL is
// not part of the event, so links are built later, when a person opens the notice.
function noticeDeps(): CreateNoticeDeps {
  const a = makeAppAdapters({ siteUrl: '', cloudId: '' });
  return {
    jira: a.jira,
    snapshots: a.snapshots,
    notices: a.notices,
    writer: makeWriter(a),
    clock: () => new Date(),
  };
}

export async function onIssueUpdated(event: IssueUpdatedEvent): Promise<void> {
  try {
    const outcome = await handleIssueUpdated(noticeDeps(), event);
    if (outcome !== 'ignored') console.log('issue updated: ship notice', { outcome });
  } catch (e) {
    console.error('issue updated trigger failed', {
      error: e instanceof Error ? e.name : 'unknown',
    });
  }
}

export async function onVersionReleased(event: VersionReleasedEvent): Promise<void> {
  try {
    await handleVersionReleased(noticeDeps(), event);
  } catch (e) {
    console.error('version released trigger failed', {
      error: e instanceof Error ? e.name : 'unknown',
    });
  }
}

interface ConnectionChange {
  action?: 'CREATED' | 'UPDATED' | 'DELETED';
  connectionId?: string;
}

// Atlassian deletes a connection's ingested objects itself when an admin disconnects,
// so forgetting the id is all the app has to do.
export async function onConnectionChange(request: ConnectionChange): Promise<void> {
  const store = makeConnectionStore();
  if (request.action === 'DELETED') {
    await store.clear();
    console.log('connector disconnected');
    return;
  }
  if (typeof request.connectionId === 'string' && request.connectionId.length > 0) {
    await store.set(request.connectionId);
    console.log('connector connected', { action: request.action });
  }
}

export async function nightly(): Promise<void> {
  const purged = await nightlyMaintenance({
    history: makeHistoryStore(),
    audit: makeAuditStore(),
    llm: makeLlmStore(),
    notices: makeShipNoticeStore(),
    clock: () => new Date(),
  });
  console.log('nightly maintenance complete', {
    historyPurged: purged.history,
    auditPurged: purged.audit,
    llmCachePurged: purged.llmCache,
    shipNoticesPurged: purged.shipNotices,
  });
}
