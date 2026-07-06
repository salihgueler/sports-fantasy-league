/**
 * FIBA Women's Basketball World Cup 2026 — Competition Configuration (R16.1, R16.3).
 *
 * Fully defines the competition as configuration. Onboarding a new SPORT
 * (basketball) requires no changes to the scoring engine, services, or
 * frontend — only this config, a new scoring ruleset, and a data-provider
 * binding. The scoring engine is sport-agnostic: it matches each rule's `stat`
 * against the player's canonical match stats and gates position-specific rules
 * by comparing `rule.position` to the player's position string.
 *
 * Unlike Bundesliga (which reused football-standard-v1), basketball needs its
 * own ruleset because the stat vocabulary and positions differ.
 *
 * Berlin, Germany · 4–13 September 2026 · 16 teams.
 */

import type {
  Sport,
  CompetitionFormat,
  ChipType,
  RosterConfig,
  TransferRules,
  ThemeTokens,
  ScoringRule,
} from '@fantasy/shared';

export interface CompetitionConfig {
  sport: Sport;
  name: string;
  format: CompetitionFormat;
  scoringRulesetId: string;
  rosterConfig: RosterConfig;
  transferRules: TransferRules;
  chips: ChipType[];
  dataProviderId: string;
  theme: ThemeTokens;
}

export const COMPETITION_ID = 'womens-basketball-world-cup-2026';
export const SCORING_RULESET_ID = 'basketball-standard-v1';
export const DATA_PROVIDER_ID = 'manual-womens-basketball-world-cup-2026';

/**
 * basketball-standard-v1 scoring ruleset.
 *
 * A complete box-score model (not a single-stat model): every meaningful
 * contribution is scored so that any player who takes the floor accrues points.
 * Each `stat` key MUST exist in CANONICAL_STATISTIC_MAP (canonical-stats.ts) and
 * match the keys produced in each player's PlayerMatchStats.stats.
 *
 * The engine (compute-player-points.ts) evaluates a flat rule as
 * `points × statValue`, and an appearance rule (conditions.min) as a one-off.
 *
 * Worked example — 20 pts / 8 reb / 6 ast / 2 stl / 1 blk / 3 TO / 2 3PM / 30 min:
 *   20(1) + 8(1) + 6(2) + 2(3) + 1(3) + 3(-1) + 2(1) + 1[appearance] = 49
 */
export const BASKETBALL_STANDARD_RULES: ScoringRule[] = [
  { stat: 'points', points: 1 },
  { stat: 'rebounds', points: 1 },
  { stat: 'assists', points: 2 },
  { stat: 'steals', points: 3 },
  { stat: 'blocks', points: 3 },
  { stat: 'turnovers', points: -1 },
  { stat: 'threePointersMade', points: 1 },
  // Appearance point: awarded once when the player logs any minutes.
  { stat: 'minutesPlayed', points: 1, conditions: { min: 1 } },
];

/**
 * Women's Basketball World Cup 2026 competition configuration.
 *
 * - New basketball-standard-v1 scoring ruleset (see BASKETBALL_STANDARD_RULES).
 * - Positions are the basketball trio G / F / C.
 * - Squad of 10 with a starting five; captain scores double.
 * - Static roster provider (no live basketball feed) — see the seed script.
 */
export const WBWC_2026_CONFIG: CompetitionConfig = {
  sport: 'basketball',
  name: "FIBA Women's Basketball World Cup 2026",
  format: 'tournament',
  scoringRulesetId: SCORING_RULESET_ID,
  rosterConfig: {
    positions: [
      { name: 'G', min: 2, max: 5 },
      { name: 'F', min: 2, max: 5 },
      { name: 'C', min: 1, max: 3 },
    ],
    squadSize: 10,
    startingXI: 5,
    budget: 100,
    captainMultiplier: 2,
    perTeamCap: 4,
  },
  transferRules: {
    freeTransfersPerGameweek: 1,
    carryOverLimit: 2,
    penaltyPointsPerExtra: 4,
    tripleCaptainMultiplier: 3,
  },
  chips: ['WILDCARD', 'TRIPLE_CAPTAIN', 'BENCH_BOOST', 'FREE_HIT'],
  dataProviderId: DATA_PROVIDER_ID,
  theme: {
    colorPrimary: '#0057B7',
    colorAccent1: '#F5820B',
    colorAccent2: '#FFFFFF',
  },
};
