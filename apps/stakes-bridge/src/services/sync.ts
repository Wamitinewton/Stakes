import { err, type Result } from '../core/result.js';
import type { BridgeStatus } from './settings.js';

export async function syncNow(): Promise<Result<BridgeStatus>> {
  return err('SYNC_UNAVAILABLE', 'HubSpot sync is not available yet.');
}
