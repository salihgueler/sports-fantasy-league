/**
 * Lambda handler for fixture sync invoked by the Data Sync Step Functions state machine.
 *
 * Receives { competitionId, dataProviderId } from the state machine and delegates
 * to the syncFixtures function (R15.2).
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { syncFixtures } from '../sync-service.js';
import type { DataSyncResult } from '../sync-service.js';

// Auto-register adapters
import '../index.js';

export interface SyncFixturesEvent {
  competitionId: string;
  dataProviderId: string;
}

const tableName = process.env.TABLE_NAME;

function getRepository(): FantasyRepository {
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return new FantasyRepository({ tableName });
}

export const handler: Handler<SyncFixturesEvent, DataSyncResult> = async (event) => {
  const { competitionId, dataProviderId } = event;

  if (!competitionId || !dataProviderId) {
    throw new Error('Missing required fields: competitionId and dataProviderId');
  }

  const repo = getRepository();
  const result = await syncFixtures({ competitionId, dataProviderId }, repo);

  // If there were errors, throw to route to RecordFailure (all-or-nothing semantics)
  if (!result.success) {
    throw new Error(
      `Fixture sync failed: ${result.errors.join('; ')}`,
    );
  }

  return result;
};
