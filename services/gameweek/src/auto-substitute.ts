/**
 * Pure auto-substitution logic for gameweek finalization.
 *
 * This module contains no I/O — it operates on in-memory data only,
 * making it testable in isolation.
 *
 * Requirements: R9.1, R9.2, R9.3, R9.4, R9.5
 */

import type { SquadSlot, RosterConfig } from '@fantasy/shared';

// ─── Input Types ────────────────────────────────────────────────────────────

export interface AutoSubstituteInput {
  /** The full squad (starters + bench). Starters have isBenched=false. */
  squad: SquadSlot[];
  /**
   * Map of playerId → minutesPlayed for this gameweek.
   * Players not in the map are treated as 0 minutes.
   */
  matchStats: Map<string, number>;
  /** Position map: playerId → position name (e.g. "GK", "DEF", "MID", "FWD"). */
  playerPositions: Map<string, string>;
  /** The competition's roster configuration with position constraints. */
  rosterConfig: RosterConfig;
}

export interface AutoSubstituteResult {
  /** The updated squad after auto-substitution and captain transfer. */
  squad: SquadSlot[];
  /** Whether the captain multiplier was transferred to the vice-captain. */
  captainTransferred: boolean;
  /** Whether no multiplier should be applied (both captain and vice played 0). */
  noMultiplier: boolean;
}

// ─── Pure Auto-Substitution Function ────────────────────────────────────────

/**
 * Perform auto-substitution on a finalized gameweek squad.
 *
 * Algorithm (R9.3):
 *  1. Identify starters with 0 minutes in ascending lineup order
 *     (lineup order = position in the original starters array).
 *  2. For each inactive starter, find the highest-priority bench player
 *     (lowest benchPriority number) with >= 1 minute that preserves
 *     RosterConfig position constraints after the swap.
 *  3. Complete one substitution before evaluating the next inactive starter.
 *
 * Captain multiplier transfer (R9.4, R9.5):
 *  - If captain played 0 min and vice-captain played >= 1 min: transfer multiplier.
 *  - If both played 0: no multiplier applied to anyone.
 *
 * @param input - The squad, match stats, player positions, and roster config.
 * @returns The updated squad and captain multiplier flags.
 */
export function autoSubstitute(input: AutoSubstituteInput): AutoSubstituteResult {
  const { matchStats, playerPositions, rosterConfig } = input;

  // Deep copy the squad to avoid mutation of the input
  let squad: SquadSlot[] = input.squad.map((s) => ({ ...s }));

  // Separate starters and bench (starters maintain their original order = lineup order)
  const starterIndices: number[] = [];
  const benchIndices: number[] = [];

  for (let i = 0; i < squad.length; i++) {
    if (!squad[i].isBenched) {
      starterIndices.push(i);
    } else {
      benchIndices.push(i);
    }
  }

  // Sort bench indices by benchPriority (ascending = highest priority first)
  benchIndices.sort(
    (a, b) => (squad[a].benchPriority ?? 99) - (squad[b].benchPriority ?? 99),
  );

  // Track which bench players have already been used for substitution
  const usedBenchIndices = new Set<number>();

  // Process each starter in ascending lineup order (R9.3)
  for (const starterIdx of starterIndices) {
    const starter = squad[starterIdx];
    const starterMinutes = matchStats.get(starter.playerId) ?? 0;

    if (starterMinutes > 0) continue; // Starter played — no substitution needed

    // Find the highest-priority eligible bench player
    for (const benchIdx of benchIndices) {
      if (usedBenchIndices.has(benchIdx)) continue;

      const benchPlayer = squad[benchIdx];
      const benchMinutes = matchStats.get(benchPlayer.playerId) ?? 0;

      if (benchMinutes < 1) continue; // Bench player did not play

      // Check if swapping preserves position constraints (R9.1)
      if (
        canSubstitute(
          starter.playerId,
          benchPlayer.playerId,
          squad,
          starterIndices,
          starterIdx,
          playerPositions,
          rosterConfig,
        )
      ) {
        // Perform the substitution: bench player becomes starter, starter goes to bench
        squad[starterIdx] = {
          ...squad[starterIdx],
          playerId: benchPlayer.playerId,
          isBenched: false,
          benchPriority: undefined,
        };
        squad[benchIdx] = {
          ...squad[benchIdx],
          playerId: starter.playerId,
          isBenched: true,
          isCaptain: false,
          isViceCaptain: false,
          benchPriority: benchPlayer.benchPriority,
        };

        usedBenchIndices.add(benchIdx);
        break; // Complete one substitution before evaluating the next (R9.3)
      }
    }
  }

  // ─── Captain Multiplier Transfer (R9.4, R9.5) ──────────────────────────

  let captainTransferred = false;
  let noMultiplier = false;

  const captainSlot = squad.find((s) => s.isCaptain);
  const viceSlot = squad.find((s) => s.isViceCaptain);

  if (captainSlot && viceSlot) {
    const captainMinutes = matchStats.get(captainSlot.playerId) ?? 0;
    const viceMinutes = matchStats.get(viceSlot.playerId) ?? 0;

    if (captainMinutes === 0 && viceMinutes >= 1) {
      // Transfer captain multiplier to vice-captain (R9.4)
      const captainIdx = squad.findIndex((s) => s.isCaptain);
      const viceIdx = squad.findIndex((s) => s.isViceCaptain);

      squad[captainIdx] = { ...squad[captainIdx], isCaptain: false };
      squad[viceIdx] = { ...squad[viceIdx], isCaptain: true, isViceCaptain: false };
      captainTransferred = true;
    } else if (captainMinutes === 0 && viceMinutes === 0) {
      // Both played 0 — no multiplier applied (R9.5)
      noMultiplier = true;
    }
  }

  return { squad, captainTransferred, noMultiplier };
}

// ─── Private: Position Constraint Check ─────────────────────────────────────

/**
 * Determine if substituting a starter with a bench player preserves
 * the RosterConfig position constraints for the starting lineup.
 *
 * Simulates the swap and validates that every position's count
 * remains within [min, max] as defined in RosterConfig.
 */
function canSubstitute(
  starterPlayerId: string,
  benchPlayerId: string,
  squad: SquadSlot[],
  starterIndices: number[],
  currentStarterIdx: number,
  playerPositions: Map<string, string>,
  rosterConfig: RosterConfig,
): boolean {
  const starterPos = playerPositions.get(starterPlayerId);
  const benchPos = playerPositions.get(benchPlayerId);

  if (!starterPos || !benchPos) return false;

  // If same position, substitution always preserves constraints
  if (starterPos === benchPos) return true;

  // Simulate the starting lineup after the swap:
  // Remove the inactive starter, add the bench player
  const positionCounts = new Map<string, number>();

  for (const idx of starterIndices) {
    const slot = squad[idx];
    // Skip the starter being replaced
    if (idx === currentStarterIdx) continue;
    const pos = playerPositions.get(slot.playerId);
    if (pos) {
      positionCounts.set(pos, (positionCounts.get(pos) ?? 0) + 1);
    }
  }

  // Add the bench player's position
  positionCounts.set(benchPos, (positionCounts.get(benchPos) ?? 0) + 1);

  // Validate against RosterConfig position constraints
  for (const posRule of rosterConfig.positions) {
    const count = positionCounts.get(posRule.name) ?? 0;
    if (count < posRule.min || count > posRule.max) {
      return false;
    }
  }

  return true;
}
