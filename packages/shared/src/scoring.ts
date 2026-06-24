/**
 * Shared, pure team-score aggregation.
 *
 * Single source of truth for turning a squad plus a map of per-player points
 * into a single team total. Used by:
 *   - the WorldCup daily sync (cumulative model: playerTotals = Player.totalPoints)
 *   - the per-gameweek scoring pipeline (playerTotals = points computed from
 *     that gameweek's PlayerMatchStats)
 *
 * Rules (R10.3, R10.4, R8.3, R8.4):
 *   - Starters contribute their points (0 if absent from the map).
 *   - The starting captain's points are multiplied by `captainMultiplier`
 *     (default 2), or by 3 when Triple Captain is active.
 *   - Bench players are excluded unless Bench Boost is active, in which case
 *     they contribute at 1x (no captain multiplier on the bench).
 *
 * This function performs NO I/O and is entirely deterministic.
 */

import type { SquadSlot } from './types.js';

export interface TeamScoreChips {
  tripleCaptain?: boolean;
  benchBoost?: boolean;
}

export function computeTeamTotal(
  squad: SquadSlot[],
  playerTotals: Map<string, number>,
  captainMultiplier = 2,
  chips: TeamScoreChips = {},
): number {
  let total = 0;

  for (const slot of squad) {
    // Bench players only count under Bench Boost.
    if (slot.isBenched && !chips.benchBoost) {
      continue;
    }

    const base = playerTotals.get(slot.playerId) ?? 0;

    // Captain multiplier applies only to a starting captain.
    let multiplier = 1;
    if (slot.isCaptain && !slot.isBenched) {
      multiplier = chips.tripleCaptain ? 3 : captainMultiplier;
    }

    total += base * multiplier;
  }

  return total;
}
