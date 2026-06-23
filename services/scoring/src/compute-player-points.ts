/**
 * Pure player-points computation.
 *
 * Applies a competition ScoringRuleset to a player's match statistics and
 * returns the total points (which may be negative) along with a signed
 * per-statistic breakdown whose values sum to the total.
 *
 * This function performs NO I/O — it is entirely deterministic.
 *
 * Rule evaluation logic:
 * - Position-specific rules are skipped if the player's position does not match.
 * - Minutes-played threshold rules award their point value once if the player's
 *   minutesPlayed meets or exceeds the threshold.
 * - Per-every-N rules award points for each complete group of N in the stat count.
 * - Flat rules (no conditions) award points × stat count (0 if stat absent).
 *
 * Requirements: 10.1, 10.8
 */

import type { PlayerMatchStats, ScoringRuleset, ScoringRule } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatPoints {
  /** The statistic key (e.g. "goals", "yellowCards"). */
  stat: string;
  /** Signed point value: positive = awarded, negative = deduction. */
  points: number;
}

export interface ScoredPlayer {
  playerId: string;
  /** Net total points — may be negative (R10.1). */
  total: number;
  /** Signed per-stat breakdown that sums to `total` (R10.8). */
  breakdown: StatPoints[];
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Computes a single player's fantasy points for a match.
 *
 * @param stats - The player's match statistics (minutesPlayed + stat counts)
 * @param ruleset - The competition's scoring ruleset containing all rules
 * @param position - The player's position (e.g. "GK", "DEF", "MID", "FWD")
 * @returns ScoredPlayer with total and per-stat breakdown
 */
export function computePlayerPoints(
  stats: PlayerMatchStats,
  ruleset: ScoringRuleset,
  position: string,
): ScoredPlayer {
  // Accumulate points per stat key — a single stat may receive contributions
  // from multiple rules (e.g. flat + per-every-N for "goals").
  const contributions = new Map<string, number>();

  for (const rule of ruleset.rules) {
    const pts = evaluateRule(rule, stats, position);
    if (pts === 0) continue;

    const key = rule.stat;
    contributions.set(key, (contributions.get(key) ?? 0) + pts);
  }

  // Build the breakdown array (only non-zero entries).
  const breakdown: StatPoints[] = [];
  let total = 0;

  for (const [stat, points] of contributions) {
    breakdown.push({ stat, points });
    total += points;
  }

  return {
    playerId: stats.playerId,
    total,
    breakdown,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Evaluates a single scoring rule against the player's stats.
 * Returns the signed point contribution (0 if rule does not apply).
 */
function evaluateRule(
  rule: ScoringRule,
  stats: PlayerMatchStats,
  position: string,
): number {
  // Position gate — skip if rule is position-specific and doesn't match.
  if (rule.position && rule.position !== position) {
    return 0;
  }

  const conditions = rule.conditions;

  // Minutes-played threshold rule.
  if (conditions?.min != null) {
    return stats.minutesPlayed >= conditions.min ? rule.points : 0;
  }

  // Per-every-N rule (e.g. 1 pt per 3 saves).
  if (conditions?.perEvery != null) {
    const statValue = stats.stats[rule.stat] ?? 0;
    const groups = Math.floor(statValue / conditions.perEvery);
    return rule.points * groups;
  }

  // Flat rule — points × stat count.
  const statValue = stats.stats[rule.stat] ?? 0;
  return rule.points * statValue;
}
