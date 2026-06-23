/**
 * Lambda handler for live score sync invoked by the Data Sync Step Functions state machine.
 *
 * Receives { competitionId, dataProviderId, fixtureId, gameweek } from the
 * Map iterator and delegates to the syncLiveScores function (R15.4).
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { syncLiveScores } from '../sync-service.js';
import type { DataSyncResult } from '../sync-service.js';

// Auto-register adapters
import '../index.js';

export interface SyncLiveScoresEvent {
  competitionId: string;
  dataProviderId: string;
  fixtureId: string;
  gameweek: number;
}

const tableName = process.env.TABLE_NAME;
const eventBusName = process.env.EVENT_BUS_NAME;

function getRepository(): FantasyRepository {
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return new FantasyRepository({ tableName });
}

export const handler: Handler<SyncLiveScoresEvent, DataSyncResult> = async (event) => {
  const { competitionId, dataProviderId, fixtureId, gameweek } = event;

  if (!competitionId || !dataProviderId || !fixtureId || gameweek === undefined) {
    throw new Error(
      'Missing required fields: competitionId, dataProviderId, fixtureId, and gameweek',
    );
  }

  const repo = getRepository();
  const result = await syncLiveScores(
    {
      competitionId,
      dataProviderId,
      fixtureId,
      gameweek,
      eventBusName: eventBusName ?? 'default',
    },
    repo,
  );

  // If there were errors, throw to route to RecordFailure
  if (!result.success) {
    throw new Error(
      `Live score sync failed for fixture ${fixtureId}: ${result.errors.join('; ')}`,
    );
  }

  return result;
};
