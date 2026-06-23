/**
 * Lambda handler for roster sync invoked by the Data Sync Step Functions state machine.
 *
 * Receives { competitionId, dataProviderId } from the state machine and delegates
 * to the syncRoster function with exponential backoff retry (R15.1, R15.5, R15.6, R15.7, R15.8).
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { syncRoster } from '../roster-sync.js';
import type { SyncResult } from '../roster-sync.js';

// Auto-register adapters
import '../index.js';

export interface SyncRosterEvent {
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

export const handler: Handler<SyncRosterEvent, SyncResult> = async (event) => {
  const { competitionId, dataProviderId } = event;

  if (!competitionId || !dataProviderId) {
    throw new Error('Missing required fields: competitionId and dataProviderId');
  }

  const repo = getRepository();
  const result = await syncRoster(competitionId, dataProviderId, repo);

  // If the sync was aborted (retries exhausted), throw so the state machine
  // routes to the RecordFailure state (all-or-nothing semantics R15.6)
  if (result.aborted) {
    throw new Error(result.error ?? 'Roster sync aborted after exhausted retries');
  }

  return result;
};
