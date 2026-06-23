/**
 * Scoring Lambda handler — wires score persistence to the scoring engine.
 *
 * Receives a scoring event (e.g. from an SQS queue or Step Functions),
 * computes the team gameweek score, and persists it with the appropriate lifecycle status.
 *
 * Requirements: 10.5, 10.6, 10.7
 */

import type { Handler } from 'aws-lambda';
import { FantasyRepository } from '@fantasy/shared';
import { persistGameweekScore } from './score-persistence.js';
import type { PersistScoreInput, PersistScoreResult } from './score-persistence.js';
import type { ScoreStatus } from '@fantasy/shared';

// ─── Event Shape ────────────────────────────────────────────────────────────

export interface ScoreEvent {
  fantasyTeamId: string;
  gameweek: number;
  competitionId: string;
  points: number;
  status: ScoreStatus;
}

export interface ScoreHandlerResult {
  fantasyTeamId: string;
  gameweek: number;
  persisted: boolean;
  finalized: boolean;
}

// ─── Handler ────────────────────────────────────────────────────────────────

const tableName = process.env.TABLE_NAME;

function getRepository(): FantasyRepository {
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return new FantasyRepository({ tableName });
}

export const handler: Handler<ScoreEvent, ScoreHandlerResult> = async (event) => {
  const repo = getRepository();

  const input: PersistScoreInput = {
    fantasyTeamId: event.fantasyTeamId,
    gameweek: event.gameweek,
    competitionId: event.competitionId,
    points: event.points,
    status: event.status,
  };

  const result: PersistScoreResult = await persistGameweekScore(repo, input);

  return {
    fantasyTeamId: event.fantasyTeamId,
    gameweek: event.gameweek,
    persisted: result.persisted,
    finalized: result.finalized,
  };
};
