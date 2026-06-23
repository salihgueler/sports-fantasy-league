/**
 * Bundesliga 2025-26 Competition Configuration Seed (R16.1, R16.3).
 *
 * This configuration record fully defines the Bundesliga 2025-26 competition.
 * Onboarding requires no changes to the scoring engine, services, or frontend —
 * only this config plus its registered DataProviderAdapter binding.
 *
 * Uses the existing 'football-standard-v1' scoring ruleset (same sport).
 */

import type {
  Sport,
  CompetitionFormat,
  ChipType,
  RosterConfig,
  TransferRules,
  ThemeTokens,
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

/**
 * Bundesliga 2025-26 competition configuration.
 *
 * - Reuses the football-standard-v1 scoring ruleset (no new ruleset needed).
 * - Points to the 'api-football-bundesliga-2025' adapter for data sync.
 * - Theme uses Bundesliga branding colors.
 */
export const BUNDESLIGA_2025_CONFIG: CompetitionConfig = {
  sport: 'football',
  name: 'Bundesliga 2025-26',
  format: 'league',
  scoringRulesetId: 'football-standard-v1',
  rosterConfig: {
    positions: [
      { name: 'GK', min: 1, max: 1 },
      { name: 'DEF', min: 3, max: 5 },
      { name: 'MID', min: 3, max: 5 },
      { name: 'FWD', min: 1, max: 3 },
    ],
    squadSize: 15,
    startingXI: 11,
    budget: 100,
    captainMultiplier: 2,
    perTeamCap: 3,
  },
  transferRules: {
    freeTransfersPerGameweek: 1,
    carryOverLimit: 2,
    penaltyPointsPerExtra: 4,
    tripleCaptainMultiplier: 3,
  },
  chips: ['WILDCARD', 'TRIPLE_CAPTAIN', 'BENCH_BOOST', 'FREE_HIT'],
  dataProviderId: 'api-football-bundesliga-2025',
  theme: {
    colorPrimary: '#D20515',
    colorAccent1: '#000000',
    colorAccent2: '#FFFFFF',
  },
};
