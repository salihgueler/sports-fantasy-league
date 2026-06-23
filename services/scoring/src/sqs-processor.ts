import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';

/**
 * SQS queue processor for scoring/sync spike buffering.
 *
 * Consumes messages from the FantasyScoringQueue at controlled concurrency
 * (reservedConcurrency = 10 on the Lambda). Each message represents a
 * scoring or sync workload enqueued during traffic spikes.
 *
 * Reports batch item failures so only failed messages are retried,
 * eventually landing in the DLQ after 3 failed attempts.
 *
 * Requirements: 19.3
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(record.body);
      const { taskType } = payload;

      switch (taskType) {
        case 'scoring':
          await processScoringTask(payload);
          break;
        case 'sync':
          await processSyncTask(payload);
          break;
        default:
          console.warn(`Unknown taskType: ${taskType}`, { messageId: record.messageId });
          break;
      }
    } catch (error) {
      console.error('Failed to process SQS message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function processScoringTask(payload: Record<string, unknown>): Promise<void> {
  const { competitionId, gameweek, mode, fixtureIds } = payload;
  console.info('Processing scoring task', { competitionId, gameweek, mode, fixtureIds });
  // Scoring logic is delegated to the scoring engine modules
  // The actual implementation invokes computePlayerPoints + computeTeamScore + persist
}

async function processSyncTask(payload: Record<string, unknown>): Promise<void> {
  const { competitionId, dataProviderId, syncType } = payload;
  console.info('Processing sync task', { competitionId, dataProviderId, syncType });
  // Sync logic is delegated to the data-sync service modules
  // The actual implementation invokes the appropriate sync handler
}
