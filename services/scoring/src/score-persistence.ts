/**
 * Gameweek score persistence with provisional/confirmed lifecycle.
 *
 * Uses DynamoDB conditional writes to enforce the state-preservation invariant:
 * a CONFIRMED score cannot be overwritten.
 *
 * Requirements: 10.5, 10.6, 10.7
 */

import type { FantasyRepository } from '@fantasy/shared';
import type { ScoreStatus } from '@fantasy/shared';
import { buildGameweekScoreKey } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PersistScoreInput {
  fantasyTeamId: string;
  gameweek: number;
  competitionId: string;
  points: number;
  status: ScoreStatus;
}

export interface PersistScoreResult {
  /** Whether the score was successfully written. */
  persisted: boolean;
  /** True if the score was already CONFIRMED and the write was rejected. */
  finalized: boolean;
}

// ─── Persistence Function ───────────────────────────────────────────────────

/**
 * Persists a gameweek score with the provisional/confirmed lifecycle.
 *
 * - PROVISIONAL scores can be written freely (overwriting prior provisional scores).
 * - CONFIRMED scores can only be written once; subsequent writes are rejected.
 * - Any attempt to overwrite a CONFIRMED score returns `{ persisted: false, finalized: true }`.
 *
 * The conditional write uses:
 * - For PROVISIONAL: `attribute_not_exists(PK) OR scoreStatus <> :confirmed`
 *   (write if item doesn't exist yet, or if existing item is not confirmed)
 * - For CONFIRMED: `attribute_not_exists(PK) OR scoreStatus <> :confirmed`
 *   (can only confirm a score that hasn't already been confirmed)
 */
export async function persistGameweekScore(
  repo: FantasyRepository,
  input: PersistScoreInput,
): Promise<PersistScoreResult> {
  const { fantasyTeamId, gameweek, competitionId, points, status } = input;

  const keys = buildGameweekScoreKey({ fantasyTeamId, gameweek, compId: competitionId, points });

  const item = {
    ...keys,
    fantasyTeamId,
    gameweek,
    competitionId,
    points,
    scoreStatus: status,
    updatedAt: new Date().toISOString(),
  };

  // Both PROVISIONAL and CONFIRMED writes use the same guard:
  // only succeed if the item doesn't exist OR its current status is not CONFIRMED.
  const succeeded = await repo.conditionalPut(item, {
    conditionExpression: 'attribute_not_exists(PK) OR #scoreStatus <> :confirmed',
    expressionAttributeNames: {
      '#scoreStatus': 'scoreStatus',
    },
    expressionAttributeValues: {
      ':confirmed': 'CONFIRMED',
    },
  });

  if (succeeded) {
    return { persisted: true, finalized: false };
  }

  // Condition failed → the score is already CONFIRMED
  return { persisted: false, finalized: true };
}
