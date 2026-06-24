/**
 * PersistScores — write each team's gameweek score and roll it up.
 *
 * Upserts a GWSCORE# item per team (PROVISIONAL in 'live' mode, CONFIRMED in
 * 'reconcile' mode; a CONFIRMED score is never overwritten — see
 * persistGameweekScore), then recomputes FantasyTeam.totalPoints as the sum of
 * the team's GWSCORE# points and refreshes the GSI1 POINTS# sort key so league
 * standings reflect it.
 *
 * Requirements: 10.5, 10.6, 10.7, 13.1
 */

import type { Handler } from 'aws-lambda';
import { buildFantasyTeamKey } from '@fantasy/shared';
import type { ScoreStatus } from '@fantasy/shared';
import { persistGameweekScore } from '../score-persistence.js';
import { getScoringRepository, normalizeMode, queryAll } from './util.js';
import type { TeamScore } from './compute-scores.js';

interface PersistScoresEvent {
  competitionId: string;
  gameweek: number;
  mode?: string;
  hasStats?: boolean;
  scores?: TeamScore[];
}

export interface PersistScoresResult {
  competitionId: string;
  gameweek: number;
  persisted: number;
  teamsRolledUp: number;
}

interface FantasyTeamItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  totalPoints: number;
}

interface GameweekScoreItem extends Record<string, unknown> {
  points?: number;
}

export const handler: Handler<PersistScoresEvent, PersistScoresResult> = async (event) => {
  const { competitionId, gameweek } = event;
  const mode = normalizeMode(event.mode);
  const status: ScoreStatus = mode === 'reconcile' ? 'CONFIRMED' : 'PROVISIONAL';
  const scores = event.scores ?? [];
  const repo = getScoringRepository();

  if (scores.length === 0) {
    return { competitionId, gameweek, persisted: 0, teamsRolledUp: 0 };
  }

  // 1. Persist each team's gameweek score (CONFIRMED scores are preserved).
  let persisted = 0;
  for (const score of scores) {
    const result = await persistGameweekScore(repo, {
      fantasyTeamId: score.fantasyTeamId,
      gameweek,
      competitionId,
      points: score.points,
      status,
    });
    if (result.persisted) {
      persisted++;
    }
  }

  // 2. Roll up totalPoints = sum of each team's GWSCORE# points. Teams are
  //    resolved to their USER# item (GWSCORE# items are not keyed by userId).
  const teams = await queryAll<FantasyTeamItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'USER#' },
  });
  const teamById = new Map<string, FantasyTeamItem>();
  for (const team of teams) {
    teamById.set(team.fantasyTeamId, team);
  }

  let teamsRolledUp = 0;
  for (const score of scores) {
    const team = teamById.get(score.fantasyTeamId);
    if (!team) {
      continue;
    }

    const gwScores = await queryAll<GameweekScoreItem>(repo, {
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      expressionAttributeValues: { ':pk': `TEAM#${score.fantasyTeamId}`, ':sk': 'GWSCORE#' },
    });
    const total = gwScores.reduce((sum, g) => sum + (g.points ?? 0), 0);

    if (total === team.totalPoints) {
      continue;
    }

    const keys = buildFantasyTeamKey({
      userId: team.userId,
      compId: competitionId,
      leagueId: team.leagueId,
      totalPoints: total,
    });
    await repo.update(
      team.PK,
      team.SK,
      'SET totalPoints = :tp, GSI1PK = :g1pk, GSI1SK = :g1sk',
      undefined,
      { ':tp': total, ':g1pk': keys.GSI1PK, ':g1sk': keys.GSI1SK },
    );
    teamsRolledUp++;
  }

  return { competitionId, gameweek, persisted, teamsRolledUp };
};
