/**
 * FIFA World Cup 2026 Seed Script.
 *
 * Fetches the openfootball World Cup 2026 datasets at runtime (Node 20+ global
 * `fetch`), maps them to the platform domain model, and writes them to DynamoDB
 * idempotently using `FantasyRepository` from `@fantasy/shared`.
 *
 * What it writes:
 *   1. ScoringRuleset  "football-standard-v1"           (create-if-absent)
 *   2. Adapter binding "api-football-world-cup-2026"    (create-if-absent)
 *   3. Players          (from squads, deterministic ids + synthetic prices)
 *   4. Fixtures + gameweeks (from the match schedule)
 *   5. Competition      "world-cup-2026"                (upsert — refreshes on reseed)
 *
 * Idempotence: ruleset/adapter use conditional create-if-absent; players and
 * fixtures use deterministic keys + deterministic content so repeated runs
 * overwrite with identical values; the competition is upserted so reseeding
 * refreshes the schedule.
 *
 * Usage:
 *   npm run seed:worldcup
 *   (or: npx tsx scripts/seed-worldcup.ts)
 *
 * Environment variables:
 *   FANTASY_TABLE_NAME — DynamoDB table name (default: FantasyTable-dev)
 *   AWS_REGION         — AWS region (default: us-east-1)
 */

import {
  FantasyRepository,
  buildPlayerKey,
  buildFixtureKey,
  buildCompetitionKey,
} from '@fantasy/shared';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.FANTASY_TABLE_NAME ?? 'FantasyTable-dev';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const COMPETITION_ID = 'world-cup-2026';
const SCORING_RULESET_ID = 'football-standard-v1';
const DATA_PROVIDER_ID = 'api-football-world-cup-2026';

const TEAMS_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.teams.json';
const SQUADS_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.squads.json';
const FIXTURES_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json';

// ─── openfootball raw shapes (parsed defensively) ─────────────────────────────

interface RawTeam {
  name?: string;
  name_normalised?: string;
  code?: string;
  fifa_code?: string;
}

interface RawPlayer {
  name?: string;
  player?: string;
  pos?: string;
  position?: string;
  number?: number;
  num?: number;
}

interface RawSquad {
  name?: string;
  team?: string;
  code?: string;
  fifa_code?: string;
  players?: RawPlayer[];
}

interface RawMatch {
  num?: number;
  round?: string;
  stage?: string;
  name?: string;
  date?: string;
  time?: string;
  team1?: unknown;
  team2?: unknown;
  group?: string;
}

interface RawRound {
  name?: string;
  round?: string;
  matches?: RawMatch[];
}

interface NormalizedRound {
  name: string;
  matches: RawMatch[];
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as unknown;
}

/** Return a top-level array, whether the payload is bare or wrapped under one of `keys`. */
function pickArray<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

/** Write items in sequential chunks so we never flood DynamoDB with one giant burst. */
async function putInChunks<T>(
  items: T[],
  write: (item: T) => Promise<void>,
  chunkSize = 25,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(write));
  }
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics so "Kovář" -> "kovar"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derive a 3-letter code from a team name when no explicit code is supplied. */
function deriveCode(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
  return (letters.slice(0, 3) || 'UNK').toUpperCase().padEnd(3, 'X');
}

const POSITION_ALIASES: Record<string, string> = {
  GK: 'GK',
  G: 'GK',
  GOALKEEPER: 'GK',
  DF: 'DEF',
  DEF: 'DEF',
  D: 'DEF',
  DEFENDER: 'DEF',
  MF: 'MID',
  MID: 'MID',
  M: 'MID',
  MIDFIELDER: 'MID',
  FW: 'FWD',
  FWD: 'FWD',
  F: 'FWD',
  FORWARD: 'FWD',
  ATTACKER: 'FWD',
  ST: 'FWD',
};

function mapPosition(pos: string | undefined): string {
  const key = (pos ?? '').trim().toUpperCase();
  return POSITION_ALIASES[key] ?? 'MID';
}

// Deterministic synthetic price bands [min, max] (in millions), stepped by 0.5.
const PRICE_BANDS: Record<string, [number, number]> = {
  GK: [4.0, 5.5],
  DEF: [4.0, 6.0],
  MID: [5.0, 8.5],
  FWD: [6.0, 11.0],
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Stable per-player price: same playerId + position always yields the same price. */
function syntheticPrice(playerId: string, position: string): number {
  const [min, max] = PRICE_BANDS[position] ?? PRICE_BANDS.MID;
  const steps = Math.round((max - min) / 0.5) + 1;
  const idx = hashString(playerId) % steps;
  return Math.round((min + idx * 0.5) * 10) / 10;
}

/**
 * Build an ISO kickoff instant from an openfootball date + (messy) time string.
 * Handles "13:00 UTC-6", "20:00", or a missing time (defaults to 18:00 UTC).
 */
function parseKickoff(date: string, time?: string): string {
  const raw = time ?? '18:00';
  const hm = /(\d{1,2}):(\d{2})/.exec(raw);
  const hh = hm ? Number(hm[1]) : 18;
  const mm = hm ? Number(hm[2]) : 0;
  const off = /UTC\s*([+-]\d{1,2})/i.exec(raw);
  const offsetHours = off ? Number(off[1]) : 0; // local = UTC + offset => UTC = local - offset
  const [y, mo, d] = date.split('-').map(Number);
  const ms = Date.UTC(y || 2026, (mo || 1) - 1, d || 1, hh - offsetHours, mm);
  return new Date(ms).toISOString();
}

// ─── Team-code normalization ──────────────────────────────────────────────────

function buildTeamCodeMap(teams: RawTeam[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of teams) {
    const code = (t.fifa_code ?? t.code ?? (t.name ? deriveCode(t.name) : '')).toUpperCase();
    if (!code) continue;
    for (const nm of [t.name, t.name_normalised]) {
      if (nm) map.set(nm.toLowerCase(), code);
    }
  }
  return map;
}

/** Resolve a fixture team reference (object, name string, or knockout placeholder) to an id. */
function resolveTeamId(team: unknown, codeMap: Map<string, string>): string {
  if (team && typeof team === 'object') {
    const o = team as Record<string, unknown>;
    const code = (o.code ?? o.fifa_code) as string | undefined;
    if (code) return code.toUpperCase();
    const name = (o.name ?? o.team) as string | undefined;
    if (name) return codeMap.get(name.toLowerCase()) ?? deriveCode(name);
    return 'TBD';
  }
  if (typeof team === 'string') {
    return codeMap.get(team.toLowerCase()) ?? team.toUpperCase(); // placeholder like "W101"/"1A" kept as-is
  }
  return 'TBD';
}

// ─── Round / gameweek grouping ────────────────────────────────────────────────

function earliestTimestamp(matches: RawMatch[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const m of matches) {
    if (!m.date) continue;
    const ts = Date.parse(parseKickoff(m.date, m.time));
    if (ts < min) min = ts;
  }
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

/**
 * Normalize the fixtures payload into ordered rounds (one round == one gameweek).
 * Supports the wrapped `{ rounds: [{ name, matches }] }` shape and the flat
 * `{ matches: [{ round, ... }] }` / bare-array shape.
 */
function buildRounds(raw: unknown): NormalizedRound[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).rounds)) {
    const rounds = (raw as Record<string, unknown>).rounds as RawRound[];
    return rounds.map((r, i) => ({
      name: r.name ?? r.round ?? `Round ${i + 1}`,
      matches: Array.isArray(r.matches) ? r.matches : [],
    }));
  }

  const matches = pickArray<RawMatch>(raw, ['matches']);
  const groups = new Map<string, RawMatch[]>();
  for (const m of matches) {
    const key = m.round ?? m.stage ?? m.name ?? 'Round 1';
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }
  const rounds = Array.from(groups.entries()).map(([name, ms]) => ({ name, matches: ms }));
  // Chronological gameweek ordering by each round's earliest kickoff (deterministic).
  rounds.sort((a, b) => earliestTimestamp(a.matches) - earliestTimestamp(b.matches));
  return rounds;
}

// ─── Scoring ruleset (identical to football-standard-v1) ──────────────────────

const FOOTBALL_STANDARD_RULES = [
  { stat: 'goals', position: 'FWD', points: 4 },
  { stat: 'goals', position: 'MID', points: 5 },
  { stat: 'goals', position: 'DEF', points: 6 },
  { stat: 'goals', position: 'GK', points: 6 },
  { stat: 'assists', points: 3 },
  { stat: 'cleanSheet', position: 'GK', points: 4 },
  { stat: 'cleanSheet', position: 'DEF', points: 4 },
  { stat: 'cleanSheet', position: 'MID', points: 1 },
  { stat: 'penaltiesSaved', points: 5 },
  { stat: 'penaltiesMissed', points: -2 },
  { stat: 'yellowCards', points: -1 },
  { stat: 'redCards', points: -3 },
  { stat: 'ownGoals', points: -2 },
  { stat: 'saves', points: 1, conditions: { perEvery: 3 } },
  { stat: 'minutesPlayed', points: 1, conditions: { min: 1 } },
  { stat: 'minutesPlayed', points: 1, conditions: { min: 60 } },
  { stat: 'goalsConceded', position: 'GK', points: -1, conditions: { perEvery: 2 } },
  { stat: 'goalsConceded', position: 'DEF', points: -1, conditions: { perEvery: 2 } },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== FIFA World Cup 2026 Seed Script ===\n');
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Competition ID: ${COMPETITION_ID}\n`);

  const repo = new FantasyRepository({
    tableName: TABLE_NAME,
    clientConfig: { region: REGION },
  });

  // ─── Fetch source data ──────────────────────────────────────────────────
  console.log('Fetching openfootball World Cup 2026 datasets...');
  const [teamsRaw, squadsRaw, fixturesRaw] = await Promise.all([
    fetchJson(TEAMS_URL),
    fetchJson(SQUADS_URL),
    fetchJson(FIXTURES_URL),
  ]);

  const teams = pickArray<RawTeam>(teamsRaw, ['teams']);
  const squads = pickArray<RawSquad>(squadsRaw, ['squads', 'teams']);
  const codeMap = buildTeamCodeMap(teams);
  console.log(`  -> ${teams.length} teams, ${squads.length} squads loaded.\n`);

  // ─── Step 1: ScoringRuleset ───────────────────────────────────────────────
  console.log(`[1/5] Ensuring ScoringRuleset "${SCORING_RULESET_ID}" exists...`);
  const rulesetWritten = await repo.conditionalPut(
    {
      PK: `RULESET#${SCORING_RULESET_ID}`,
      SK: 'META',
      rulesetId: SCORING_RULESET_ID,
      sport: 'football',
      entityType: 'SCORING_RULESET',
      rules: FOOTBALL_STANDARD_RULES,
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(rulesetWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 2: Adapter binding ──────────────────────────────────────────────
  console.log(`[2/5] Ensuring Adapter binding "${DATA_PROVIDER_ID}" exists...`);
  const adapterWritten = await repo.conditionalPut(
    {
      PK: `ADAPTER#${DATA_PROVIDER_ID}`,
      SK: 'META',
      providerId: DATA_PROVIDER_ID,
      sport: 'football',
      description: 'Data provider adapter for FIFA World Cup 2026 (openfootball)',
      entityType: 'DATA_PROVIDER_ADAPTER',
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(adapterWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 3: Players ──────────────────────────────────────────────────────
  console.log('[3/5] Building and writing players from squads...');
  const playerItems: Record<string, unknown>[] = [];
  const usedPlayerIds = new Set<string>();

  for (const squad of squads) {
    const teamName = squad.name ?? squad.team ?? '';
    const teamCode = (
      squad.fifa_code ??
      squad.code ??
      (teamName ? deriveCode(teamName) : 'UNK')
    ).toUpperCase();
    const players = Array.isArray(squad.players) ? squad.players : [];

    players.forEach((pl, idx) => {
      const playerName = pl.name ?? pl.player ?? `Player ${idx + 1}`;
      const position = mapPosition(pl.pos ?? pl.position);

      let playerId = `${teamCode.toLowerCase()}-${slugify(playerName)}`;
      if (usedPlayerIds.has(playerId)) {
        const shirt = pl.number ?? pl.num ?? idx;
        playerId = `${playerId}-${shirt}`;
        if (usedPlayerIds.has(playerId)) playerId = `${playerId}-${idx}`;
      }
      usedPlayerIds.add(playerId);

      const price = syntheticPrice(playerId, position);
      const keys = buildPlayerKey({
        compId: COMPETITION_ID,
        playerId,
        realTeamId: teamCode,
        position,
        price,
        totalPoints: 0,
      });

      playerItems.push({
        ...keys,
        entityType: 'PLAYER',
        playerId,
        name: playerName,
        position,
        realTeamId: teamCode,
        competitionId: COMPETITION_ID,
        price,
        totalPoints: 0,
        availability: 'available',
      });
    });
  }

  await putInChunks(playerItems, (item) => repo.put(item), 25);
  console.log(`  -> ${playerItems.length} players written.`);

  // ─── Step 4: Fixtures + gameweeks ─────────────────────────────────────────
  console.log('[4/5] Building and writing fixtures + gameweeks...');
  const rounds = buildRounds(fixturesRaw);
  const gameweeks: { gameweek: number; transferDeadline: string; status: string }[] = [];
  const fixtureItems: Record<string, unknown>[] = [];
  let earliestOverall = Number.POSITIVE_INFINITY;

  rounds.forEach((round, ri) => {
    const gwNum = ri + 1;
    let earliestInRound = Number.POSITIVE_INFINITY;

    round.matches.forEach((m, mi) => {
      const date = m.date ?? '2026-06-11';
      const kickoffTime = parseKickoff(date, m.time);
      const kickoffTs = Date.parse(kickoffTime);
      if (kickoffTs < earliestInRound) earliestInRound = kickoffTs;
      if (kickoffTs < earliestOverall) earliestOverall = kickoffTs;

      const suffix = m.num != null ? String(m.num) : String(mi);
      const fixtureId = `wc26-${gwNum}-${suffix}`;
      const homeTeamId = resolveTeamId(m.team1, codeMap);
      const awayTeamId = resolveTeamId(m.team2, codeMap);

      const keys = buildFixtureKey({
        compId: COMPETITION_ID,
        gameweek: gwNum,
        fixtureId,
        kickoffTs: kickoffTime,
      });

      fixtureItems.push({
        ...keys,
        entityType: 'FIXTURE',
        fixtureId,
        competitionId: COMPETITION_ID,
        gameweek: gwNum,
        round: round.name,
        homeTeamId,
        awayTeamId,
        kickoffTime,
        status: 'scheduled',
      });
    });

    const deadline = Number.isFinite(earliestInRound)
      ? new Date(earliestInRound).toISOString()
      : new Date().toISOString();
    gameweeks.push({ gameweek: gwNum, transferDeadline: deadline, status: 'upcoming' });
  });

  await putInChunks(fixtureItems, (item) => repo.put(item), 25);
  console.log(`  -> ${fixtureItems.length} fixtures written across ${gameweeks.length} gameweeks.`);

  const startTs = Number.isFinite(earliestOverall)
    ? new Date(earliestOverall).toISOString()
    : new Date().toISOString();

  // ─── Step 5: Competition (upsert so reseeding refreshes the schedule) ─────
  console.log(`[5/5] Upserting Competition "${COMPETITION_ID}"...`);
  const compKeys = buildCompetitionKey({
    compId: COMPETITION_ID,
    status: 'upcoming',
    startTs,
  });
  const existing = await repo.get(compKeys.PK, compKeys.SK);
  const now = new Date().toISOString();

  await repo.put({
    ...compKeys,
    entityType: 'COMPETITION',
    competitionId: COMPETITION_ID,
    sport: 'football',
    name: 'FIFA World Cup 2026',
    format: 'tournament',
    scoringRulesetId: SCORING_RULESET_ID,
    dataProviderId: DATA_PROVIDER_ID,
    status: 'upcoming',
    rosterConfig: {
      positions: [
        { name: 'GK', min: 2, max: 2 },
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
    schedule: { gameweeks },
    theme: {
      colorPrimary: '#326295',
      colorAccent1: '#C8102E',
      colorAccent2: '#FFD700',
    },
    createdAt: (existing?.createdAt as string | undefined) ?? now,
    updatedAt: now,
  });
  console.log(
    existing ? '  -> Updated existing competition (schedule refreshed).' : '  -> Created.',
  );

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n=== Seed Complete ===');
  console.log(`  Competition: ${COMPETITION_ID} (FIFA World Cup 2026)`);
  console.log(`  Teams:       ${teams.length}`);
  console.log(`  Players:     ${playerItems.length}`);
  console.log(`  Fixtures:    ${fixtureItems.length}`);
  console.log(`  Gameweeks:   ${gameweeks.length}`);
  console.log(`  Start (UTC): ${startTs}`);
  console.log('\nRe-running this script is safe: it refreshes data idempotently.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
