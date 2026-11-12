import { makeConnectionStore } from '../adapters/storage.js';

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
