/**
 * FetchStats — ensure PlayerMatchStats (STATS#) exist for a gameweek's fixtures.
 *
 * Invoked by the scoring Step Functions Map (one invocation per target). For each
 * fixture it delegates to syncLiveScores, which fetches live stats from the
 * competition's data provider and upserts STATS#<gw>#<playerId> items.
 *
 * Per-fixture failures are collected, not thrown: a competition whose provider
 * does not expose live stats simply yields no STATS#, and the downstream
 * ComputeScores step skips it. This keeps one provider's gap from failing the
 * whole gameweek.
 *
 * Requirements: 15.4
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { syncLiveScores } from '../sync-service.js';

// Auto-register data provider adapters.
import '../index.js';

interface FetchGameweekStatsEvent {
  competitionId: string;
  gameweek: number;
  fixtureIds?: string[];
  dataProviderId: string;
  mode?: string;
}

interface FetchGameweekStatsResult {
  competitionId: string;
  gameweek: number;
  mode: string;
  fixturesProcessed: number;
  statsWritten: number;
  errors: string[];
}

const tableName = process.env.TABLE_NAME;
const eventBusName = process.env.EVENT_BUS_NAME;

export const handler: Handler<FetchGameweekStatsEvent, FetchGameweekStatsResult> = async (
  event,
) => {
  const { competitionId, gameweek, dataProviderId } = event;
  const mode = event.mode === 'reconcile' ? 'reconcile' : 'live';
  const fixtureIds = event.fixtureIds ?? [];

  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  const repo = new FantasyRepository({ tableName });

  let statsWritten = 0;
  const errors: string[] = [];

  for (const fixtureId of fixtureIds) {
    try {
      const result = await syncLiveScores(
        {
          competitionId,
          fixtureId,
          dataProviderId,
          gameweek,
          eventBusName: eventBusName ?? 'default',
        },
        repo,
      );
      statsWritten += result.processed;
      if (!result.success) {
        errors.push(...result.errors);
      }
    } catch (err: unknown) {
      errors.push(`Fixture ${fixtureId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    competitionId,
    gameweek,
    mode,
    fixturesProcessed: fixtureIds.length,
    statsWritten,
    errors,
  };
};
