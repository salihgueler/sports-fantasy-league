/**
 * Lambda handler for price sync invoked by the Data Sync Step Functions state machine.
 *
 * Receives { competitionId } from the state machine and delegates
 * to the syncPrices function (R15.3).
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { syncPrices } from '../sync-service.js';
import type { DataSyncResult } from '../sync-service.js';

export interface SyncPricesEvent {
  competitionId: string;
}

const tableName = process.env.TABLE_NAME;

function getRepository(): FantasyRepository {
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return new FantasyRepository({ tableName });
}

export const handler: Handler<SyncPricesEvent, DataSyncResult> = async (event) => {
  const { competitionId } = event;

  if (!competitionId) {
    throw new Error('Missing required field: competitionId');
  }

  const repo = getRepository();
  const result = await syncPrices({ competitionId }, repo);

  // If there were errors, throw to route to RecordFailure (all-or-nothing semantics)
  if (!result.success) {
    throw new Error(
      `Price sync failed: ${result.errors.join('; ')}`,
    );
  }

  return result;
};
