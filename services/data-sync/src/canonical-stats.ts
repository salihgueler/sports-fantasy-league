/**
 * Canonical Statistic Map and mapping utility (R16.5, R16.6).
 *
 * The platform defines an authoritative set of canonical stat keys used for
 * scoring. External provider statistics must be mapped through this system;
 * unmapped keys are rejected and never applied to scoring.
 */

/**
 * The canonical stat keys recognized by the platform's scoring engine.
 * Each key has a human-readable description for reporting/debugging.
 */
export const CANONICAL_STATISTIC_MAP: Record<string, string> = {
  goals: 'Goals scored',
  assists: 'Assists',
  saves: 'Goalkeeper saves',
  yellowCards: 'Yellow cards received',
  redCards: 'Red cards received',
  minutesPlayed: 'Minutes played',
  ownGoals: 'Own goals scored',
  cleanSheets: 'Clean sheets (keeper/defender)',
  penaltiesSaved: 'Penalties saved by goalkeeper',
  penaltiesMissed: 'Penalties missed by outfield player',
  penaltiesScored: 'Penalties scored',
  shotsOnTarget: 'Shots on target',
  tackles: 'Tackles won',
  interceptions: 'Interceptions made',
  foulsCommitted: 'Fouls committed',
  foulsSuffered: 'Fouls suffered',
  offsides: 'Offsides',
  crosses: 'Crosses attempted',
  crossesAccurate: 'Accurate crosses',
  passes: 'Passes attempted',
  passesAccurate: 'Accurate passes',
  keyPasses: 'Key passes (leading to a shot)',
  dribbles: 'Dribbles attempted',
  dribblesSuccessful: 'Successful dribbles',
  aerialDuelsWon: 'Aerial duels won',
  goalsConceded: 'Goals conceded (keeper/defender)',
  bigChancesCreated: 'Big chances created',
  bigChancesMissed: 'Big chances missed',
  clearances: 'Clearances',
  blocks: 'Blocks',
  bonus: 'Bonus points awarded',
};

/**
 * Set of valid canonical stat keys for fast lookup.
 */
export const CANONICAL_KEYS = new Set<string>(Object.keys(CANONICAL_STATISTIC_MAP));

/**
 * Result of mapping raw external stats to canonical keys.
 */
export interface MapCanonicalStatsResult {
  /** Successfully mapped canonical stat keys with their numeric values. */
  mapped: Record<string, number>;
  /** External keys that had no entry in the stat map — rejected (R16.6). */
  rejected: string[];
}

/**
 * Maps raw external statistics through a provider-specific stat map to the
 * platform's canonical stat keys.
 *
 * - Only keys that exist in `statMap` AND whose target is in the canonical set
 *   are included in the result.
 * - Keys in `raw` that are NOT in `statMap` are collected in `rejected`.
 * - Values must be numeric; non-numeric values are treated as rejected.
 *
 * @param raw     - The raw statistics object from the external provider.
 * @param statMap - A mapping of external key → canonical key for this provider.
 * @returns An object with `mapped` canonical stats and `rejected` unmapped keys.
 *
 * @example
 * ```ts
 * const statMap = { 'goals_scored': 'goals', 'yellow_card': 'yellowCards' };
 * const raw = { goals_scored: 2, yellow_card: 1, xG: 0.8 };
 * const result = mapToCanonicalStats(raw, statMap);
 * // result.mapped => { goals: 2, yellowCards: 1 }
 * // result.rejected => ['xG']
 * ```
 */
export function mapToCanonicalStats(
  raw: Record<string, unknown>,
  statMap: Record<string, string>
): MapCanonicalStatsResult {
  const mapped: Record<string, number> = {};
  const rejected: string[] = [];

  for (const [externalKey, value] of Object.entries(raw)) {
    const canonicalKey = statMap[externalKey];

    // No mapping entry for this external key → reject (R16.6)
    if (!canonicalKey) {
      rejected.push(externalKey);
      continue;
    }

    // Mapped key must be a recognized canonical key
    if (!CANONICAL_KEYS.has(canonicalKey)) {
      rejected.push(externalKey);
      continue;
    }

    // Value must be numeric
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(numericValue)) {
      rejected.push(externalKey);
      continue;
    }

    mapped[canonicalKey] = numericValue;
  }

  return { mapped, rejected };
}
