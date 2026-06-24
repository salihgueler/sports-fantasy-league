/**
 * ComputeScores — per-team gameweek scoring for one competition + gameweek.
 *
 * Reads the gameweek's PlayerMatchStats (STATS#), the competition ScoringRuleset,
 * and player positions, scores each player with the pure rule engine, then sums
 * each fantasy team's squad (applying the captain multiplier and any active chips)
 * via the shared computeTeamTotal.
 *
 * GUARD: if no STATS# exist for the gameweek, this returns an empty score set so
 * the pipeline does not overwrite totals owned by the cumulative model (Part A,
 * e.g. the World Cup daily sync). A competition only ever uses one model.
 *
 * Requirements: 10.1, 10.3, 10.4, 10.8
 */

import type { Handler } from 'aws-lambda';
import { buildScoringRulesetKey, computeTeamTotal } from '@fantasy/shared';
import type { PlayerMatchStats, ScoringRule, ScoringRuleset, Sport, SquadSlot } from '@fantasy/shared';
import { computePlayerPoints } from '../compute-player-points.js';
import { getScoringRepository, normalizeMode, queryAll, type ScoringMode } from './util.js';

interface ComputeScoresEvent {
  competitionId: string;
  gameweek: number;
  mode?: string;
}

export interface TeamScore {
  fantasyTeamId: string;
  points: number;
}

export interface ComputeScoresResult {
  competitionId: string;
  gameweek: number;
  mode: ScoringMode;
  hasStats: boolean;
  scores: TeamScore[];
}

interface StatsItem extends Record<string, unknown> {
  playerId: string;
  fixtureId: string;
  minutesPlayed?: number;
  stats?: Record<string, number>;
}

interface PlayerItem extends Record<string, unknown> {
  playerId: string;
  position: string;
}

interface CompetitionItem extends Record<string, unknown> {
  scoringRulesetId: string;
  sport?: Sport;
  rosterConfig?: { captainMultiplier?: number };
}

interface RulesetItem extends Record<string, unknown> {
  rulesetId?: string;
  sport?: Sport;
  rules?: ScoringRule[];
}

interface FantasyTeamItem extends Record<string, unknown> {
  fantasyTeamId: string;
  squad?: SquadSlot[];
}

interface ChipItem extends Record<string, unknown> {
  chipType: string;
  gameweek: number;
}

export const handler: Handler<ComputeScoresEvent, ComputeScoresResult> = async (event) => {
  const { competitionId, gameweek } = event;
  const mode = normalizeMode(event.mode);
  const repo = getScoringRepository();
  const gwPadded = String(gameweek).padStart(3, '0');

  // 1. Gameweek stats. No stats → nothing to score (guard for Part A competitions).
  const statsItems = await queryAll<StatsItem>(repo, {
    keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    expressionAttributeValues: {
      ':pk': `COMPETITION#${competitionId}`,
      ':sk': `STATS#${gwPadded}#`,
    },
  });

  if (statsItems.length === 0) {
    return { competitionId, gameweek, mode, hasStats: false, scores: [] };
  }

  // 2. Competition + ruleset.
  const competition = await repo.get<CompetitionItem>(`COMPETITION#${competitionId}`, 'META');
  if (!competition) {
    return { competitionId, gameweek, mode, hasStats: false, scores: [] };
  }
  const captainMultiplier = competition.rosterConfig?.captainMultiplier ?? 2;

  const rulesetKey = buildScoringRulesetKey(competition.scoringRulesetId);
  const rulesetItem = await repo.get<RulesetItem>(rulesetKey.PK, rulesetKey.SK);
  const ruleset: ScoringRuleset = {
    rulesetId: rulesetItem?.rulesetId ?? competition.scoringRulesetId,
    sport: rulesetItem?.sport ?? competition.sport ?? 'football',
    rules: rulesetItem?.rules ?? [],
  };

  // 3. Player positions (needed for position-gated rules).
  const players = await queryAll<PlayerItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'POINTS#' },
  });
  const positions = new Map<string, string>();
  for (const p of players) {
    positions.set(p.playerId, p.position);
  }

  // 4. Per-player points for the gameweek (summed across a player's fixtures).
  const playerPoints = new Map<string, number>();
  for (const item of statsItems) {
    const stats: PlayerMatchStats = {
      playerId: item.playerId,
      fixtureId: item.fixtureId,
      minutesPlayed: item.minutesPlayed ?? 0,
      stats: item.stats ?? {},
    };
    const scored = computePlayerPoints(stats, ruleset, positions.get(item.playerId) ?? '');
    playerPoints.set(item.playerId, (playerPoints.get(item.playerId) ?? 0) + scored.total);
  }

  // 5. Team gameweek scores (captain multiplier + active chips).
  const teams = await queryAll<FantasyTeamItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'USER#' },
  });

  const scores: TeamScore[] = await Promise.all(
    teams.map(async (team) => {
      const chipItems = await queryAll<ChipItem>(repo, {
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        expressionAttributeValues: { ':pk': `TEAM#${team.fantasyTeamId}`, ':sk': 'CHIP#' },
      });
      const active = chipItems.filter((c) => c.gameweek === gameweek);
      const chips = {
        tripleCaptain: active.some((c) => c.chipType === 'TRIPLE_CAPTAIN'),
        benchBoost: active.some((c) => c.chipType === 'BENCH_BOOST'),
      };
      const points = computeTeamTotal(team.squad ?? [], playerPoints, captainMultiplier, chips);
      return { fantasyTeamId: team.fantasyTeamId, points };
    }),
  );

  return { competitionId, gameweek, mode, hasStats: true, scores };
};
