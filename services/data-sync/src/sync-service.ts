/**
 * Sync Service — fixture, price, and live-score synchronization (R15.2, R15.3, R15.4).
 *
 * Each function uses the registered DataProviderAdapter resolved by the
 * competition's `dataProviderId`, wraps external calls with exponential backoff
 * retry (R15.5), and persists results to DynamoDB via FantasyRepository.
 */

import type { PlayerMatchStats } from '@fantasy/shared';
import { buildFixtureKey, FantasyRepository } from '@fantasy/shared';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getAdapter } from './adapter-registry.js';
import { withRetry } from './backoff.js';
import type { Fixture } from './adapter-interface.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncFixturesInput {
  competitionId: string;
  dataProviderId: string;
}

export interface SyncPricesInput {
  competitionId: string;
}

export interface SyncLiveScoresInput {
  competitionId: string;
  fixtureId: string;
  dataProviderId: string;
  gameweek: number;
  eventBusName: string;
}

export interface DataSyncResult {
  success: boolean;
  processed: number;
  errors: string[];
}

// ─── syncFixtures (R15.2) ───────────────────────────────────────────────────

/**
 * Fetches fixtures from the data provider and upserts each into DynamoDB.
 * Updates kickoff time, venue (home/away teams), status, and scores.
 */
export async function syncFixtures(
  input: SyncFixturesInput,
  repo: FantasyRepository,
): Promise<DataSyncResult> {
  const { competitionId, dataProviderId } = input;
  const adapter = getAdapter(dataProviderId);

  const fixtures: Fixture[] = await withRetry(() => adapter.fetchFixtures(competitionId));

  const errors: string[] = [];
  let processed = 0;

  for (const fixture of fixtures) {
    try {
      const keys = buildFixtureKey({
        compId: competitionId,
        gameweek: fixture.gameweek,
        fixtureId: fixture.fixtureId,
        kickoffTs: fixture.kickoffTime,
      });

      const item = {
        ...keys,
        fixtureId: fixture.fixtureId,
        competitionId,
        gameweek: fixture.gameweek,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        kickoffTime: fixture.kickoffTime,
        status: fixture.status,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        entityType: 'FIXTURE',
        updatedAt: new Date().toISOString(),
      };

      await repo.put(item);
      processed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Fixture ${fixture.fixtureId}: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    processed,
    errors,
  };
}

// ─── syncPrices (R15.3) ─────────────────────────────────────────────────────

/**
 * Recomputes player prices based on transfer activity and appends to price history.
 *
 * Pricing model: net transfer balance (transfers in - transfers out) adjusts
 * the current price by ±0.1 per net transfer. Price floors at 0.1 to prevent
 * zero/negative prices.
 */
export async function syncPrices(
  input: SyncPricesInput,
  repo: FantasyRepository,
): Promise<DataSyncResult> {
  const { competitionId } = input;

  // Query all players for the competition (PK = COMPETITION#<compId>, SK begins with PLAYER#)
  const result = await repo.query<Record<string, unknown>>({
    keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    expressionAttributeValues: {
      ':pk': `COMPETITION#${competitionId}`,
      ':skPrefix': 'PLAYER#',
    },
  });

  const players = result.items;
  const errors: string[] = [];
  let processed = 0;
  const now = new Date().toISOString();

  for (const player of players) {
    try {
      const playerId = player['playerId'] as string;
      const currentPrice = (player['price'] as number) ?? 5.0;
      const transfersIn = (player['transfersIn'] as number) ?? 0;
      const transfersOut = (player['transfersOut'] as number) ?? 0;
      const netTransfers = transfersIn - transfersOut;

      // Apply price change: ±0.1 per net transfer
      const priceChange = netTransfers * 0.1;
      const newPrice = Math.max(0.1, Math.round((currentPrice + priceChange) * 10) / 10);

      // Append to price history
      const priceHistory: Array<{ price: number; date: string }> =
        (player['priceHistory'] as Array<{ price: number; date: string }>) ?? [];
      priceHistory.push({ price: newPrice, date: now });

      // Update the player record
      await repo.update(
        `COMPETITION#${competitionId}`,
        `PLAYER#${playerId}`,
        'SET #price = :newPrice, #priceHistory = :priceHistory, #transfersIn = :zero, #transfersOut = :zero, #updatedAt = :now',
        {
          '#price': 'price',
          '#priceHistory': 'priceHistory',
          '#transfersIn': 'transfersIn',
          '#transfersOut': 'transfersOut',
          '#updatedAt': 'updatedAt',
        },
        {
          ':newPrice': newPrice,
          ':priceHistory': priceHistory,
          ':zero': 0,
          ':now': now,
        },
      );

      processed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const playerId = player['playerId'] ?? 'unknown';
      errors.push(`Player ${playerId}: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    processed,
    errors,
  };
}

// ─── syncLiveScores (R15.4) ─────────────────────────────────────────────────

/**
 * Fetches live match statistics for a fixture, persists PlayerMatchStats to DDB,
 * and publishes a `ScoreUpdated` event to EventBridge for the Realtime fan-out.
 */
export async function syncLiveScores(
  input: SyncLiveScoresInput,
  repo: FantasyRepository,
  eventBridgeClient?: EventBridgeClient,
): Promise<DataSyncResult> {
  const { competitionId, fixtureId, dataProviderId, gameweek, eventBusName } = input;
  const adapter = getAdapter(dataProviderId);

  const stats: PlayerMatchStats[] = await withRetry(() => adapter.fetchLiveScores(fixtureId));

  const errors: string[] = [];
  let processed = 0;
  const now = new Date().toISOString();
  const gwPadded = String(gameweek).padStart(3, '0');

  for (const playerStats of stats) {
    try {
      // Persist to DDB: PK = COMPETITION#<compId>, SK = STATS#<gw>#<playerId>
      const item = {
        PK: `COMPETITION#${competitionId}`,
        SK: `STATS#${gwPadded}#${playerStats.playerId}`,
        playerId: playerStats.playerId,
        fixtureId,
        competitionId,
        gameweek,
        minutesPlayed: playerStats.minutesPlayed,
        stats: playerStats.stats,
        entityType: 'PLAYER_MATCH_STATS',
        updatedAt: now,
      };

      await repo.put(item);
      processed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Stats ${playerStats.playerId}: ${message}`);
    }
  }

  // Publish ScoreUpdated event to EventBridge
  const ebClient = eventBridgeClient ?? new EventBridgeClient({});
  try {
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'fantasy.data-sync',
            DetailType: 'ScoreUpdated',
            EventBusName: eventBusName,
            Detail: JSON.stringify({
              competitionId,
              fixtureId,
              gameweek,
              playerCount: stats.length,
              timestamp: now,
            }),
          },
        ],
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`EventBridge publish: ${message}`);
  }

  return {
    success: errors.length === 0,
    processed,
    errors,
  };
}
