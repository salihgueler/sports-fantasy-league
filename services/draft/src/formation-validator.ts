/**
 * Pure formation validation function.
 *
 * Validates a formation (starting lineup assignment) against the competition RosterConfig.
 * This function performs NO I/O — it operates entirely on in-memory data.
 *
 * Validation checks:
 * 1. Starting count — slots with isBenched === false must equal rosterConfig.startingXI
 * 2. Per-position min/max — each position in the starting lineup respects per-position bounds
 * 3. Members of squad — all starting players must be present in the squad
 */

import type { SquadSlot, Player, RosterConfig } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FormationValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FormationValidationResult {
  valid: boolean;
  errors: FormationValidationError[];
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validates a formation against the competition's roster configuration.
 *
 * @param squad - The proposed squad slots with isBenched flags representing the formation
 * @param players - Lookup map of playerId → Player for resolving positions
 * @param rosterConfig - The competition's roster configuration constraints
 * @param existingSquadPlayerIds - Set of player IDs currently in the persisted squad
 * @returns FormationValidationResult with all discovered errors (or valid: true)
 */
export function validateFormation(
  squad: SquadSlot[],
  players: Map<string, Player>,
  rosterConfig: RosterConfig,
  existingSquadPlayerIds: Set<string>,
): FormationValidationResult {
  const errors: FormationValidationError[] = [];

  // Separate starters and bench
  const starters = squad.filter((slot) => !slot.isBenched);
  const starterPlayerIds = starters.map((s) => s.playerId);

  // 1. Starting count must equal rosterConfig.startingXI
  if (starters.length !== rosterConfig.startingXI) {
    errors.push({
      code: 'INVALID_FORMATION',
      message: `Starting lineup has ${starters.length} players but requires exactly ${rosterConfig.startingXI}`,
      details: {
        actual: starters.length,
        required: rosterConfig.startingXI,
      },
    });
  }

  // 2. All starting players must be members of the persisted squad
  const notInSquad: string[] = [];
  for (const playerId of starterPlayerIds) {
    if (!existingSquadPlayerIds.has(playerId)) {
      notInSquad.push(playerId);
    }
  }

  if (notInSquad.length > 0) {
    errors.push({
      code: 'PLAYER_NOT_IN_SQUAD',
      message: `Starting player(s) not in squad: ${notInSquad.join(', ')}`,
      details: { playerIds: notInSquad },
    });
  }

  // 3. Per-position min/max within the starting lineup
  // Only check positions for players that exist in the lookup map
  const positionCounts = new Map<string, number>();
  for (const slot of starters) {
    const player = players.get(slot.playerId);
    if (player) {
      positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1);
    }
  }

  const positionViolations: Array<{
    position: string;
    count: number;
    min: number;
    max: number;
  }> = [];

  for (const posConfig of rosterConfig.positions) {
    const count = positionCounts.get(posConfig.name) ?? 0;
    if (count < posConfig.min || count > posConfig.max) {
      positionViolations.push({
        position: posConfig.name,
        count,
        min: posConfig.min,
        max: posConfig.max,
      });
    }
  }

  if (positionViolations.length > 0) {
    errors.push({
      code: 'INVALID_FORMATION',
      message: `Position constraints violated: ${positionViolations.map((v) => `${v.position} has ${v.count} (requires ${v.min}–${v.max})`).join('; ')}`,
      details: { violations: positionViolations },
    });
  }

  // Return result
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
