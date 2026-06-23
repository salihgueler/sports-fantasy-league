/**
 * @fantasy/data-sync — Data Provider Adapter and Sync Service public API.
 */

export type { DataProviderAdapter, Fixture } from './adapter-interface.js';

export {
  registerAdapter,
  getAdapter,
  unregisterAdapter,
  listRegisteredProviders,
} from './adapter-registry.js';

export { CANONICAL_STATISTIC_MAP, CANONICAL_KEYS, mapToCanonicalStats } from './canonical-stats.js';
export type { MapCanonicalStatsResult } from './canonical-stats.js';

export { worldCup2026Adapter } from './adapters/world-cup-2026.js';
export { bundesliga2025Adapter } from './adapters/bundesliga-2025.js';

export { BUNDESLIGA_2025_CONFIG } from './competitions/bundesliga-2025.js';
export type { CompetitionConfig } from './competitions/bundesliga-2025.js';

export { syncRoster } from './roster-sync.js';
export type { SyncResult } from './roster-sync.js';

export { syncFixtures, syncPrices, syncLiveScores } from './sync-service.js';
export type {
  SyncFixturesInput,
  SyncPricesInput,
  SyncLiveScoresInput,
  DataSyncResult,
} from './sync-service.js';

// ─── Auto-register bundled adapters ─────────────────────────────────────────
import { registerAdapter } from './adapter-registry.js';
import { worldCup2026Adapter } from './adapters/world-cup-2026.js';
import { bundesliga2025Adapter } from './adapters/bundesliga-2025.js';

registerAdapter(worldCup2026Adapter);
registerAdapter(bundesliga2025Adapter);
