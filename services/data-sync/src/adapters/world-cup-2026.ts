/**
 * World Cup 2026 Data Provider Adapter (R16.4, R16.5, R18.7).
 *
 * Implements the DataProviderAdapter interface using the API-Football service
 * as the external data source for FIFA World Cup 2026 rosters, fixtures, and
 * live scores. Credentials are retrieved from AWS Secrets Manager at runtime.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { Player, PlayerMatchStats } from '@fantasy/shared';
import type { DataProviderAdapter, Fixture } from '../adapter-interface.js';
import { mapToCanonicalStats } from '../canonical-stats.js';

// ─── Stat Key Mapping ──────────────────────────────────────────────────────

/**
 * Maps API-Football statistic keys to the platform's canonical stat keys.
 */
const API_FOOTBALL_STAT_MAP: Record<string, string> = {
  'goals.total': 'goals',
  'goals.assists': 'assists',
  'cards.yellow': 'yellowCards',
  'cards.red': 'redCards',
  'games.minutes': 'minutesPlayed',
  'penalty.saved': 'penaltiesSaved',
  'penalty.missed': 'penaltiesMissed',
  'goals.conceded': 'goalsConceded',
  'goals.saves': 'saves',
};

// ─── Secrets ────────────────────────────────────────────────────────────────

interface ApiFootballCredentials {
  apiKey: string;
  baseUrl: string;
}

const secretsClient = new SecretsManagerClient({});

let cachedCredentials: ApiFootballCredentials | null = null;

async function getCredentials(): Promise<ApiFootballCredentials> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const secretName = process.env.API_FOOTBALL_SECRET_NAME;
  if (!secretName) {
    throw new Error(
      'Environment variable API_FOOTBALL_SECRET_NAME is not set. ' +
        'Cannot retrieve API-Football credentials from Secrets Manager.'
    );
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );

  if (!response.SecretString) {
    throw new Error(
      `Secret "${secretName}" does not contain a string value.`
    );
  }

  const secret = JSON.parse(response.SecretString) as ApiFootballCredentials;

  if (!secret.apiKey || !secret.baseUrl) {
    throw new Error(
      `Secret "${secretName}" must contain "apiKey" and "baseUrl" fields.`
    );
  }

  cachedCredentials = secret;
  return cachedCredentials;
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function apiFootballGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const { apiKey, baseUrl } = await getCredentials();

  const url = new URL(endpoint, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-apisports-key': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `API-Football request failed: ${response.status} ${response.statusText} for ${endpoint}`
    );
  }

  return response.json() as Promise<T>;
}

// ─── API-Football Response Types ────────────────────────────────────────────

interface ApiFootballPlayer {
  player: {
    id: number;
    name: string;
  };
  statistics: Array<{
    team: { id: number };
    games: { position: string | null };
  }>;
}

interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
  };
  league: {
    id: number;
    round: string;
  };
  teams: {
    home: { id: number };
    away: { id: number };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

interface ApiFootballPlayerStats {
  player: { id: number };
  statistics: Array<{
    games: { minutes: number | null };
    goals: {
      total: number | null;
      conceded: number | null;
      assists: number | null;
      saves: number | null;
    };
    cards: {
      yellow: number | null;
      red: number | null;
    };
    penalty: {
      saved: number | null;
      missed: number | null;
    };
  }>;
}

// ─── Adapter Implementation ─────────────────────────────────────────────────

function mapApiPosition(position: string | null): string {
  switch (position) {
    case 'Goalkeeper':
      return 'GK';
    case 'Defender':
      return 'DEF';
    case 'Midfielder':
      return 'MID';
    case 'Attacker':
      return 'FWD';
    default:
      return 'MID';
  }
}

function mapFixtureStatus(shortStatus: string): Fixture['status'] {
  switch (shortStatus) {
    case '1H':
    case '2H':
    case 'HT':
    case 'ET':
    case 'P':
    case 'LIVE':
      return 'live';
    case 'FT':
    case 'AET':
    case 'PEN':
      return 'finished';
    case 'PST':
    case 'CANC':
    case 'ABD':
    case 'AWD':
    case 'WO':
      return 'postponed';
    default:
      return 'scheduled';
  }
}

function extractGameweek(round: string): number {
  const match = round.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

function flattenPlayerStats(
  stats: ApiFootballPlayerStats['statistics'][0]
): Record<string, unknown> {
  return {
    'goals.total': stats.goals.total ?? 0,
    'goals.assists': stats.goals.assists ?? 0,
    'goals.conceded': stats.goals.conceded ?? 0,
    'goals.saves': stats.goals.saves ?? 0,
    'cards.yellow': stats.cards.yellow ?? 0,
    'cards.red': stats.cards.red ?? 0,
    'games.minutes': stats.games.minutes ?? 0,
    'penalty.saved': stats.penalty.saved ?? 0,
    'penalty.missed': stats.penalty.missed ?? 0,
  };
}

export const worldCup2026Adapter: DataProviderAdapter = {
  providerId: 'api-football-world-cup-2026',

  async fetchRosters(competitionId: string): Promise<Player[]> {
    const response = await apiFootballGet<{ response: ApiFootballPlayer[] }>(
      '/v3/players',
      { league: competitionId, season: '2026' }
    );

    return response.response.map((entry) => {
      const stat = entry.statistics[0];
      return {
        playerId: String(entry.player.id),
        name: entry.player.name,
        position: mapApiPosition(stat?.games.position ?? null),
        realTeamId: String(stat?.team.id ?? 0),
        competitionId,
        price: 0, // Price is managed separately by the pricing engine
        totalPoints: 0,
        availability: 'available' as const,
      };
    });
  },

  async fetchFixtures(competitionId: string): Promise<Fixture[]> {
    const response = await apiFootballGet<{ response: ApiFootballFixture[] }>(
      '/v3/fixtures',
      { league: competitionId, season: '2026' }
    );

    return response.response.map((entry) => ({
      fixtureId: String(entry.fixture.id),
      competitionId,
      gameweek: extractGameweek(entry.league.round),
      homeTeamId: String(entry.teams.home.id),
      awayTeamId: String(entry.teams.away.id),
      kickoffTime: entry.fixture.date,
      status: mapFixtureStatus(entry.fixture.status.short),
      homeScore: entry.goals.home ?? undefined,
      awayScore: entry.goals.away ?? undefined,
    }));
  },

  async fetchLiveScores(fixtureId: string): Promise<PlayerMatchStats[]> {
    const response = await apiFootballGet<{ response: Array<{ players: ApiFootballPlayerStats[] }> }>(
      '/v3/fixtures/players',
      { fixture: fixtureId }
    );

    const results: PlayerMatchStats[] = [];

    for (const team of response.response) {
      for (const playerEntry of team.players) {
        const stat = playerEntry.statistics[0];
        if (!stat) continue;

        const flattened = flattenPlayerStats(stat);
        const { mapped } = mapToCanonicalStats(flattened, API_FOOTBALL_STAT_MAP);

        results.push({
          playerId: String(playerEntry.player.id),
          fixtureId,
          minutesPlayed: (stat.games.minutes ?? 0),
          stats: mapped,
        });
      }
    }

    return results;
  },

  mapToCanonicalStats(raw: unknown): { mapped: Record<string, number>; rejected: string[] } {
    if (typeof raw !== 'object' || raw === null) {
      return { mapped: {}, rejected: [] };
    }
    return mapToCanonicalStats(raw as Record<string, unknown>, API_FOOTBALL_STAT_MAP);
  },
};
