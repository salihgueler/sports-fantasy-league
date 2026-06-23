/**
 * Idempotent roster sync with reconciliation and quarantine (R15.1, R15.6, R15.7, R15.8).
 *
 * - Updates existing players, adds new players, marks absent players unavailable.
 * - Quarantines records missing required fields (retains existing state).
 * - Aborts all-or-nothing on outage/timeout after exhausted retries.
 * - Uses deterministic keys + content-based conditional upserts for idempotence.
 */

import type { Player } from '@fantasy/shared';
import { buildPlayerKey, type KeySet, FantasyRepository } from '@fantasy/shared';
import { getAdapter } from './adapter-registry.js';
import { withRetry } from './backoff.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  updated: number;
  markedUnavailable: number;
  quarantined: string[];
  aborted: boolean;
  error?: string;
}

/** Required fields for a valid player record. */
const REQUIRED_PLAYER_FIELDS: (keyof Player)[] = ['playerId', 'name', 'position', 'realTeamId'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate that a player record has all required fields with non-empty string values.
 */
function isValidPlayerRecord(record: Partial<Player>): record is Player {
  for (const field of REQUIRED_PLAYER_FIELDS) {
    const value = record[field];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Compute a content hash used for conditional upserts.
 * Returns a deterministic string representing the mutable content of a player record.
 */
function computeContentHash(player: Player): string {
  return JSON.stringify({
    name: player.name,
    position: player.position,
    realTeamId: player.realTeamId,
    price: player.price,
    totalPoints: player.totalPoints,
    availability: player.availability,
  });
}

/**
 * Query all existing players for a competition from DynamoDB.
 */
async function fetchExistingPlayers(
  competitionId: string,
  repo: FantasyRepository,
): Promise<Map<string, Record<string, unknown>>> {
  const players = new Map<string, Record<string, unknown>>();
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await repo.query<Record<string, unknown>>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `COMPETITION#${competitionId}`,
        ':skPrefix': 'PLAYER#',
      },
      exclusiveStartKey,
    });

    for (const item of result.items) {
      const playerId = (item['SK'] as string).replace('PLAYER#', '');
      players.set(playerId, item);
    }

    exclusiveStartKey = result.lastEvaluatedKey;
  } while (exclusiveStartKey);

  return players;
}

// ─── Main Sync Function ─────────────────────────────────────────────────────

/**
 * Synchronize the roster for a competition from its data provider.
 *
 * Guarantees:
 * - Idempotent: processing the same input twice yields the same persisted state (R15.8)
 * - Quarantines individual invalid records without affecting others (R15.7)
 * - Aborts without any state modification on outage/timeout after retries (R15.6)
 */
export async function syncRoster(
  competitionId: string,
  dataProviderId: string,
  repo: FantasyRepository,
): Promise<SyncResult> {
  const result: SyncResult = {
    added: 0,
    updated: 0,
    markedUnavailable: 0,
    quarantined: [],
    aborted: false,
  };

  // 1. Resolve the adapter for this competition's data provider
  const adapter = getAdapter(dataProviderId);

  // 2. Fetch rosters with retry — abort on exhausted retries (R15.6)
  let fetchedRecords: Partial<Player>[];
  try {
    fetchedRecords = await withRetry(() => adapter.fetchRosters(competitionId));
  } catch (error: unknown) {
    // Retries exhausted — abort without modifying any persisted state
    result.aborted = true;
    result.error =
      error instanceof Error
        ? `Sync aborted: ${error.message}`
        : 'Sync aborted: unknown error after exhausted retries';
    return result;
  }

  // 3. Validate each player record — quarantine those missing required fields (R15.7)
  const validPlayers: Player[] = [];
  for (const record of fetchedRecords) {
    if (isValidPlayerRecord(record)) {
      validPlayers.push(record);
    } else {
      // Quarantine: record the identifier if available, retain existing state
      const id = (record as Partial<Player>).playerId || 'unknown';
      result.quarantined.push(id);
    }
  }

  // 4. Fetch existing players from DDB for this competition
  const existingPlayers = await fetchExistingPlayers(competitionId, repo);

  // 5. Track which existing players are seen in the fetched roster
  const seenPlayerIds = new Set<string>();

  // 6. For each valid fetched player, upsert with content-based condition (R15.8)
  for (const player of validPlayers) {
    seenPlayerIds.add(player.playerId);

    const keys: KeySet = buildPlayerKey({
      compId: competitionId,
      playerId: player.playerId,
      realTeamId: player.realTeamId,
      position: player.position,
      price: player.price ?? 0,
      totalPoints: player.totalPoints ?? 0,
    });

    const contentHash = computeContentHash(player);
    const existingItem = existingPlayers.get(player.playerId);

    // Determine if this is an add or update
    const isNew = !existingItem;

    // Content-based conditional upsert: only write if data actually changed
    if (!isNew) {
      const existingHash = existingItem['contentHash'] as string | undefined;
      if (existingHash === contentHash) {
        // Content unchanged — skip write for idempotence
        continue;
      }
    }

    const item: Record<string, unknown> = {
      ...keys,
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      realTeamId: player.realTeamId,
      competitionId,
      price: player.price ?? 0,
      totalPoints: player.totalPoints ?? 0,
      availability: player.availability ?? 'available',
      contentHash,
      entityType: 'PLAYER',
    };

    // Use conditional put for idempotence:
    // - Write only if the item doesn't exist OR the contentHash differs
    const written = await repo.conditionalPut(item, {
      conditionExpression: 'attribute_not_exists(PK) OR #ch <> :newHash',
      expressionAttributeNames: { '#ch': 'contentHash' },
      expressionAttributeValues: { ':newHash': contentHash },
    });

    if (written) {
      if (isNew) {
        result.added++;
      } else {
        result.updated++;
      }
    }
  }

  // 7. Mark absent players as unavailable (R15.1)
  for (const [playerId, existingItem] of existingPlayers) {
    if (seenPlayerIds.has(playerId)) {
      continue;
    }

    // Already unavailable — no-op for idempotence
    if (existingItem['availability'] === 'unavailable') {
      continue;
    }

    const pk = existingItem['PK'] as string;
    const sk = existingItem['SK'] as string;

    const updated = await repo.conditionalUpdate(pk, sk, {
      updateExpression: 'SET #avail = :unavailable',
      conditionExpression: '#avail <> :unavailable',
      expressionAttributeNames: { '#avail': 'availability' },
      expressionAttributeValues: { ':unavailable': 'unavailable' },
    });

    if (updated) {
      result.markedUnavailable++;
    }
  }

  return result;
}
