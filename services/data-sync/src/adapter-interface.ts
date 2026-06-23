/**
 * Data Provider Adapter interface (R16.4).
 *
 * Each external data source implements this interface to supply roster,
 * fixture, and live-score data in the platform's canonical format.
 */

import type { Player, PlayerMatchStats } from '@fantasy/shared';

/**
 * Represents a scheduled or completed match within a competition.
 */
export interface Fixture {
  fixtureId: string;
  competitionId: string;
  gameweek: number;
  homeTeamId: string;
  awayTeamId: string;
  kickoffTime: string; // UTC ISO-8601
  status: 'scheduled' | 'live' | 'finished' | 'postponed';
  homeScore?: number;
  awayScore?: number;
}

/**
 * Pluggable adapter that maps an external data source to the platform's
 * canonical data model. Registered per competition and resolved via
 * `dataProviderId` (R16.4).
 */
export interface DataProviderAdapter {
  /** Unique identifier for this provider (e.g. "api-football-v3"). */
  readonly providerId: string;

  /** Fetch the full player roster for a competition. */
  fetchRosters(competitionId: string): Promise<Player[]>;

  /** Fetch fixtures (matches) for a competition. */
  fetchFixtures(competitionId: string): Promise<Fixture[]>;

  /** Fetch live/final player stats for a specific fixture. */
  fetchLiveScores(fixtureId: string): Promise<PlayerMatchStats[]>;

  /**
   * Map raw external statistics to canonical stat keys (R16.5, R16.6).
   * Only mapped keys are included; unmapped keys are rejected with an error.
   */
  mapToCanonicalStats(raw: unknown): { mapped: Record<string, number>; rejected: string[] };
}
