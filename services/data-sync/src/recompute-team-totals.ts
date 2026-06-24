/**
 * Cumulative team-total recompute (Part A).
 *
 * Turns each fantasy team's squad into a single cumulative total by summing the
 * squad players' `Player.totalPoints` (which the WorldCup daily sync keeps
 * current from goals scored) with the captain multiplier applied. The result is
 * written to `FantasyTeam.totalPoints` and the GSI1 `POINTS#` sort key is
 * refreshed so league standings reflect it.
 *
 * This is the season-cumulative model: there is no per-gameweek granularity, so
 * per-gameweek chips (Triple Captain, Bench Boost) are not applied here — only
 * the standing captain multiplier. The per-gameweek pipeline (Part B) handles
 * gameweek-level scoring with chips.
 *
 * Idempotent: teams whose computed total already matches are left untouched.
 */

import { FantasyRepository, buildFantasyTeamKey, computeTeamTotal } from '@fantasy/shared';
import type { SquadSlot } from '@fantasy/shared';

interface PlayerItem extends Record<string, unknown> {
  playerId: string;
  totalPoints: number;
}

interface FantasyTeamItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  competitionId: string;
  squad?: SquadSlot[];
  totalPoints: number;
}

interface CompetitionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  competitionId: string;
  rosterConfig?: { captainMultiplier?: number };
}

export interface RecomputeTeamTotalsResult {
  teamsUpdated: number;
  teamsScanned: number;
}

async function queryAll<T extends Record<string, unknown>>(
  repo: FantasyRepository,
  opts: Parameters<FantasyRepository['query']>[0],
): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await repo.query<T>({ ...opts, exclusiveStartKey: startKey });
    items.push(...(res.items as T[]));
    startKey = res.lastEvaluatedKey;
  } while (startKey);
  return items;
}

/**
 * Recompute and persist `FantasyTeam.totalPoints` for every team in a
 * competition from the current `Player.totalPoints` values.
 */
export async function recomputeTeamTotals(
  repo: FantasyRepository,
  competitionId: string,
): Promise<RecomputeTeamTotalsResult> {
  const competition = await repo.get<CompetitionItem>(`COMPETITION#${competitionId}`, 'META');
  const captainMultiplier = competition?.rosterConfig?.captainMultiplier ?? 2;

  // Player points map (GSI2: COMP#<id> / POINTS#... → players only).
  const players = await queryAll<PlayerItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'POINTS#' },
  });

  const playerTotals = new Map<string, number>();
  for (const p of players) {
    playerTotals.set(p.playerId, p.totalPoints ?? 0);
  }

  // Fantasy teams (GSI2: COMP#<id> / USER#... → teams only).
  const teams = await queryAll<FantasyTeamItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'USER#' },
  });

  let teamsUpdated = 0;
  for (const team of teams) {
    const squad = team.squad ?? [];
    const total = computeTeamTotal(squad, playerTotals, captainMultiplier);

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
    teamsUpdated++;
  }

  return { teamsUpdated, teamsScanned: teams.length };
}
