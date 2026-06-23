import type { SquadSlot } from '@fantasy/shared';
import type { ScoredPlayer } from './compute-player-points.js';

/**
 * Chip state active for the current gameweek, relevant to team score aggregation.
 */
export interface ActiveChips {
  tripleCaptain: boolean;
  benchBoost: boolean;
}

/**
 * Per-player breakdown entry in the team gameweek score result.
 */
export interface PlayerScoreEntry {
  playerId: string;
  points: number;
  multiplier: number;
}

/**
 * Result of computing a team's total gameweek score.
 */
export interface TeamGameweekScoreResult {
  points: number;
  breakdown: PlayerScoreEntry[];
}

/**
 * Computes the team's total gameweek score by aggregating individual player scores
 * with captain multiplier logic and chip modifiers.
 *
 * Algorithm:
 * 1. Starters contribute their scored total (default 0 if not in the scored map).
 * 2. The captain's points are multiplied by `captainMultiplier` (default 2),
 *    or by 3 if Triple Captain is active (R10.3, R8.3).
 * 3. If Bench Boost is active, bench players' points are also included at 1x
 *    (no captain multiplier applied to bench players, even if marked captain) (R10.4, R8.4).
 * 4. Returns the total and a per-player breakdown.
 *
 * This function is PURE: no I/O, no side effects.
 *
 * @param squad - The team's squad slots (starters and bench)
 * @param scored - Map from playerId to their ScoredPlayer result
 * @param chips - Active chip state for the gameweek
 * @param captainMultiplier - From RosterConfig, defaults to 2
 */
export function computeTeamGameweekScore(
  squad: SquadSlot[],
  scored: Map<string, ScoredPlayer>,
  chips: ActiveChips,
  captainMultiplier: number = 2,
): TeamGameweekScoreResult {
  const breakdown: PlayerScoreEntry[] = [];
  let totalPoints = 0;

  const starters = squad.filter((slot) => !slot.isBenched);
  const bench = squad.filter((slot) => slot.isBenched);

  // Process starters
  for (const slot of starters) {
    const playerScore = scored.get(slot.playerId)?.total ?? 0;
    let multiplier = 1;

    if (slot.isCaptain) {
      multiplier = chips.tripleCaptain ? 3 : captainMultiplier;
    }

    const points = playerScore * multiplier;
    totalPoints += points;
    breakdown.push({ playerId: slot.playerId, points, multiplier });
  }

  // Process bench players only if Bench Boost is active
  if (chips.benchBoost) {
    for (const slot of bench) {
      const playerScore = scored.get(slot.playerId)?.total ?? 0;
      const multiplier = 1;
      const points = playerScore * multiplier;
      totalPoints += points;
      breakdown.push({ playerId: slot.playerId, points, multiplier });
    }
  }

  return { points: totalPoints, breakdown };
}
