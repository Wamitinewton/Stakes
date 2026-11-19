import { makeSyncAdapters } from '../adapters/index.js';
import { CONNECTION_KEY, makeBridgeStore, type BridgeStore } from '../adapters/storage.js';
import { runCrmSync } from '../services/sync.js';

interface ConnectionChange {
  action?: 'CREATED' | 'UPDATED' | 'DELETED';
  connectionId?: string;
}

export async function onConnectionChange(
  request: ConnectionChange,
  store: BridgeStore = makeBridgeStore(),
): Promise<void> {
  if (request.action === 'DELETED') {
    await store.delete(CONNECTION_KEY);
    console.log('bridge connector disconnected');
    return;
  }
  if (request.connectionId) {
    await store.set(CONNECTION_KEY, request.connectionId);
    console.log('bridge connector connected', { action: request.action });
  }
}

export async function crmSync(): Promise<void> {
  const result = await runCrmSync(makeSyncAdapters());
  if (!result.ok) console.error('scheduled CRM sync failed', { code: result.error.code });
}
