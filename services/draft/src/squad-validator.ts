/**
 * Pure squad validation function.
 *
 * Validates a squad selection against the competition RosterConfig.
 * This function performs NO I/O — it operates entirely on in-memory data.
 *
 * Validation checks (all errors are collected before returning):
 * 1. Distinct players — no duplicates
 * 2. Squad size — must equal rosterConfig.squadSize
 * 3. Competition membership — each player must belong to the competition
 * 4. Per-position min/max — count players per position against rosterConfig.positions
 * 5. Per-team cap — max players from one real-world team
 * 6. Budget — sum of player prices must be ≤ rosterConfig.budget
 */

import type { SquadSlot, Player, RosterConfig } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  remainingBudget?: number;
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validates a squad against the competition's roster configuration.
 *
 * @param squad - The list of squad slots submitted by the user
 * @param players - Lookup map of playerId → Player for all referenced players
 * @param rosterConfig - The competition's roster configuration constraints
 * @param competitionId - The competition the squad is being submitted for
 * @returns ValidationResult with all discovered errors (or valid + remainingBudget)
 */
export function validateSquad(
  squad: SquadSlot[],
  players: Map<string, Player>,
  rosterConfig: RosterConfig,
  competitionId: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Distinct players — check for duplicates
  const playerIds = squad.map((slot) => slot.playerId);
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const id of playerIds) {
    if (seen.has(id)) {
      duplicates.push(id);
    }
    seen.add(id);
  }

  if (duplicates.length > 0) {
    errors.push({
      code: 'DUPLICATE_PLAYER',
      message: `Squad contains duplicate player(s): ${duplicates.join(', ')}`,
      details: { duplicatePlayerIds: duplicates },
    });
  }

  // 2. Squad size — must equal rosterConfig.squadSize
  if (squad.length !== rosterConfig.squadSize) {
    errors.push({
      code: 'INVALID_SQUAD_SIZE',
      message: `Squad has ${squad.length} players but requires exactly ${rosterConfig.squadSize}`,
      details: { actual: squad.length, required: rosterConfig.squadSize },
    });
  }

  // 3. Competition membership — each player must belong to the competition
  const invalidPlayers: string[] = [];
  for (const slot of squad) {
    const player = players.get(slot.playerId);
    if (!player || player.competitionId !== competitionId) {
      invalidPlayers.push(slot.playerId);
    }
  }

  if (invalidPlayers.length > 0) {
    errors.push({
      code: 'INVALID_PLAYER_SELECTION',
      message: `Player(s) not in competition: ${invalidPlayers.join(', ')}`,
      details: { invalidPlayerIds: invalidPlayers, reason: 'not_in_competition' },
    });
  }

  // For checks 4–6, only consider players that were actually found in the lookup
  const resolvedPlayers = squad
    .map((slot) => players.get(slot.playerId))
    .filter((p): p is Player => p !== undefined);

  // 4. Per-position min/max — count players per position against rosterConfig.positions
  const positionCounts = new Map<string, number>();
  for (const player of resolvedPlayers) {
    positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1);
  }

  const positionViolations: Array<{ position: string; count: number; min: number; max: number }> =
    [];
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
      code: 'INVALID_POSITION_COUNT',
      message: `Position constraints violated: ${positionViolations.map((v) => `${v.position} has ${v.count} (requires ${v.min}–${v.max})`).join('; ')}`,
      details: { violations: positionViolations },
    });
  }

  // 5. Per-team cap — max players from one real-world team
  const teamCounts = new Map<string, string[]>();
  for (const player of resolvedPlayers) {
    const existing = teamCounts.get(player.realTeamId) ?? [];
    existing.push(player.playerId);
    teamCounts.set(player.realTeamId, existing);
  }

  const teamViolations: Array<{ realTeamId: string; count: number; cap: number }> = [];
  for (const [teamId, playerList] of teamCounts) {
    if (playerList.length > rosterConfig.perTeamCap) {
      teamViolations.push({
        realTeamId: teamId,
        count: playerList.length,
        cap: rosterConfig.perTeamCap,
      });
    }
  }

  if (teamViolations.length > 0) {
    errors.push({
      code: 'INVALID_PLAYER_SELECTION',
      message: `Per-team cap exceeded: ${teamViolations.map((v) => `team ${v.realTeamId} has ${v.count} players (max ${v.cap})`).join('; ')}`,
      details: { violations: teamViolations, reason: 'per_team_cap_exceeded' },
    });
  }

  // 6. Budget — sum of player prices must be ≤ rosterConfig.budget
  const totalPrice = resolvedPlayers.reduce((sum, player) => sum + player.price, 0);

  if (totalPrice > rosterConfig.budget) {
    errors.push({
      code: 'BUDGET_EXCEEDED',
      message: `Total squad price ${totalPrice} exceeds budget ${rosterConfig.budget}`,
      details: { totalPrice, budget: rosterConfig.budget, overspend: totalPrice - rosterConfig.budget },
    });
  }

  // Return result
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    remainingBudget: rosterConfig.budget - totalPrice,
  };
}
