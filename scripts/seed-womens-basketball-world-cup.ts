/**
 * FIBA Women's Basketball World Cup 2026 Seed Script — Portability Proof.
 *
 * Demonstrates onboarding a NEW SPORT (basketball) with ZERO changes to the
 * scoring engine, frontend, API middleware, or any service. Only additions:
 *   - Competition config + ruleset (services/data-sync/src/competitions/womens-basketball-world-cup-2026.ts)
 *   - Static roster dataset       (…/womens-basketball-world-cup-2026.rosters.ts)
 *   - This seed script
 *
 * Mirrors scripts/seed-worldcup.ts but sources players from an embedded dataset
 * (there is no free live basketball feed like openfootball) and writes the
 * known group-stage schedule from the 21 April 2026 draw.
 *
 * What it writes (idempotently):
 *   1. ScoringRuleset  "basketball-standard-v1"                 (create-if-absent)
 *   2. Adapter binding "manual-womens-basketball-world-cup-2026" (create-if-absent)
 *   3. Players          (192, deterministic ids + synthetic prices)
 *   4. Fixtures + gameweeks (24 group-stage fixtures, 7 gameweeks)
 *   5. Competition      "womens-basketball-world-cup-2026"       (upsert)
 *
 * Usage:
 *   npm run seed:womens-basketball
 *   (or: npx tsx scripts/seed-womens-basketball-world-cup.ts)
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
import {
  WBWC_2026_CONFIG,
  BASKETBALL_STANDARD_RULES,
  COMPETITION_ID,
  SCORING_RULESET_ID,
  DATA_PROVIDER_ID,
} from '../services/data-sync/src/competitions/womens-basketball-world-cup-2026.js';
import { WBWC_2026_ROSTERS } from '../services/data-sync/src/competitions/womens-basketball-world-cup-2026.rosters.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.FANTASY_TABLE_NAME ?? 'FantasyTable-dev';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

// ─── Group-stage schedule (from the 21 April 2026 draw) ───────────────────────
// Preliminary round: Gameday 1 (4 Sep), Gameday 2 (5–6 Sep), Gameday 3 (7 Sep).

interface FixtureDef {
  gw: number;
  date: string;
  home: string;
  away: string;
}

const GROUP_FIXTURES: FixtureDef[] = [
  // GW1 — Gameday 1 (4 September)
  { gw: 1, date: '2026-09-04', home: 'JPN', away: 'MLI' },
  { gw: 1, date: '2026-09-04', home: 'ESP', away: 'GER' },
  { gw: 1, date: '2026-09-04', home: 'KOR', away: 'NGA' },
  { gw: 1, date: '2026-09-04', home: 'HUN', away: 'FRA' },
  { gw: 1, date: '2026-09-04', home: 'AUS', away: 'PUR' },
  { gw: 1, date: '2026-09-04', home: 'BEL', away: 'TUR' },
  { gw: 1, date: '2026-09-04', home: 'USA', away: 'CHN' },
  { gw: 1, date: '2026-09-04', home: 'CZE', away: 'ITA' },
  // GW2 — Gameday 2 (5–6 September)
  { gw: 2, date: '2026-09-05', home: 'MLI', away: 'ESP' },
  { gw: 2, date: '2026-09-05', home: 'GER', away: 'JPN' },
  { gw: 2, date: '2026-09-05', home: 'NGA', away: 'HUN' },
  { gw: 2, date: '2026-09-05', home: 'FRA', away: 'KOR' },
  { gw: 2, date: '2026-09-06', home: 'TUR', away: 'AUS' },
  { gw: 2, date: '2026-09-06', home: 'PUR', away: 'BEL' },
  { gw: 2, date: '2026-09-06', home: 'CHN', away: 'CZE' },
  { gw: 2, date: '2026-09-06', home: 'ITA', away: 'USA' },
  // GW3 — Gameday 3 (7 September)
  { gw: 3, date: '2026-09-07', home: 'JPN', away: 'ESP' },
  { gw: 3, date: '2026-09-07', home: 'GER', away: 'MLI' },
  { gw: 3, date: '2026-09-07', home: 'HUN', away: 'KOR' },
  { gw: 3, date: '2026-09-07', home: 'NGA', away: 'FRA' },
  { gw: 3, date: '2026-09-07', home: 'BEL', away: 'AUS' },
  { gw: 3, date: '2026-09-07', home: 'PUR', away: 'TUR' },
  { gw: 3, date: '2026-09-07', home: 'USA', away: 'CZE' },
  { gw: 3, date: '2026-09-07', home: 'ITA', away: 'CHN' },
];

// Knockout gameweeks have no fixed matchups until the group stage completes.
// They are represented as schedule gameweeks with transfer deadlines only;
// fixtures can be added by a reseed once the bracket is known.
const KNOCKOUT_GAMEWEEKS: { gameweek: number; date: string; label: string }[] = [
  { gameweek: 4, date: '2026-09-08', label: 'Qualification to quarter-finals' },
  { gameweek: 5, date: '2026-09-10', label: 'Quarter-finals' },
  { gameweek: 6, date: '2026-09-12', label: 'Semi-finals' },
  { gameweek: 7, date: '2026-09-13', label: 'Third place & Final' },
];

// Deterministic tip-off slots (UTC) so repeated runs are byte-identical.
const SLOT_TIMES = ['13:00', '15:30', '18:00', '20:30'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Deterministic synthetic price bands [min, max] (in millions), stepped by 0.5.
const PRICE_BANDS: Record<string, [number, number]> = {
  G: [5.5, 11.0],
  F: [5.5, 11.5],
  C: [5.0, 10.5],
};

/** Stable per-player price: same playerId + position always yields the same price. */
function syntheticPrice(playerId: string, position: string): number {
  const [min, max] = PRICE_BANDS[position] ?? PRICE_BANDS.G;
  const steps = Math.round((max - min) / 0.5) + 1;
  const idx = hashString(playerId) % steps;
  return Math.round((min + idx * 0.5) * 10) / 10;
}

function kickoffIso(date: string, slot: number): string {
  const time = SLOT_TIMES[slot % SLOT_TIMES.length];
  return new Date(`${date}T${time}:00.000Z`).toISOString();
}

async function putInChunks<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  size: number,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== FIBA Women's Basketball World Cup 2026 Seed Script ===\n");
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Competition ID: ${COMPETITION_ID}\n`);

  const repo = new FantasyRepository({
    tableName: TABLE_NAME,
    clientConfig: { region: REGION },
  });

  // ─── Step 1: ScoringRuleset (basketball-standard-v1) ───────────────────────
  console.log(`[1/5] Ensuring ScoringRuleset "${SCORING_RULESET_ID}" exists...`);
  const rulesetWritten = await repo.conditionalPut(
    {
      PK: `RULESET#${SCORING_RULESET_ID}`,
      SK: 'META',
      rulesetId: SCORING_RULESET_ID,
      sport: 'basketball',
      entityType: 'SCORING_RULESET',
      rules: BASKETBALL_STANDARD_RULES,
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(rulesetWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 2: Adapter binding ───────────────────────────────────────────────
  console.log(`[2/5] Ensuring Adapter binding "${DATA_PROVIDER_ID}" exists...`);
  const adapterWritten = await repo.conditionalPut(
    {
      PK: `ADAPTER#${DATA_PROVIDER_ID}`,
      SK: 'META',
      providerId: DATA_PROVIDER_ID,
      sport: 'basketball',
      description:
        "Static roster provider for FIBA Women's Basketball World Cup 2026 (no live feed)",
      entityType: 'DATA_PROVIDER_ADAPTER',
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(adapterWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 3: Players ───────────────────────────────────────────────────────
  console.log('[3/5] Building and writing players from rosters...');
  const playerItems: Record<string, unknown>[] = [];
  const usedPlayerIds = new Set<string>();

  for (const team of WBWC_2026_ROSTERS) {
    const teamCode = team.code.toUpperCase();

    team.players.forEach((pl, idx) => {
      const position = pl.position;

      let playerId = `${teamCode.toLowerCase()}-${slugify(pl.name)}`;
      if (usedPlayerIds.has(playerId)) {
        const shirt = pl.number ?? idx;
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
        name: pl.name,
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

  // ─── Step 4: Fixtures + gameweeks ──────────────────────────────────────────
  console.log('[4/5] Building and writing fixtures + gameweeks...');
  const fixtureItems: Record<string, unknown>[] = [];
  const earliestByGw = new Map<number, number>();
  let earliestOverall = Number.POSITIVE_INFINITY;

  // Assign a deterministic slot per fixture within its gameweek.
  const slotByGw = new Map<number, number>();
  for (const fx of GROUP_FIXTURES) {
    const slot = slotByGw.get(fx.gw) ?? 0;
    slotByGw.set(fx.gw, slot + 1);

    const kickoffTime = kickoffIso(fx.date, slot);
    const kickoffTs = Date.parse(kickoffTime);
    if (kickoffTs < (earliestByGw.get(fx.gw) ?? Number.POSITIVE_INFINITY)) {
      earliestByGw.set(fx.gw, kickoffTs);
    }
    if (kickoffTs < earliestOverall) earliestOverall = kickoffTs;

    const fixtureId = `wbwc26-${fx.gw}-${slot + 1}`;
    const keys = buildFixtureKey({
      compId: COMPETITION_ID,
      gameweek: fx.gw,
      fixtureId,
      kickoffTs: kickoffTime,
    });

    fixtureItems.push({
      ...keys,
      entityType: 'FIXTURE',
      fixtureId,
      competitionId: COMPETITION_ID,
      gameweek: fx.gw,
      round: `Preliminary Round — Gameday ${fx.gw}`,
      homeTeamId: fx.home,
      awayTeamId: fx.away,
      kickoffTime,
      status: 'scheduled',
    });
  }

  await putInChunks(fixtureItems, (item) => repo.put(item), 25);

  // Group-stage gameweeks: deadline = earliest tip-off in the gameweek.
  const gameweeks: { gameweek: number; transferDeadline: string; status: string }[] = [];
  for (const gw of [1, 2, 3]) {
    const earliest = earliestByGw.get(gw);
    gameweeks.push({
      gameweek: gw,
      transferDeadline: earliest
        ? new Date(earliest).toISOString()
        : new Date(`2026-09-0${gw + 3}T13:00:00.000Z`).toISOString(),
      status: 'upcoming',
    });
  }
  // Knockout gameweeks: deadline = 10:00 UTC on the gameday (fixtures TBD).
  for (const ko of KNOCKOUT_GAMEWEEKS) {
    gameweeks.push({
      gameweek: ko.gameweek,
      transferDeadline: new Date(`${ko.date}T10:00:00.000Z`).toISOString(),
      status: 'upcoming',
    });
  }

  console.log(
    `  -> ${fixtureItems.length} fixtures written across ${gameweeks.length} gameweeks.`,
  );

  // ─── Step 5: Competition (upsert so reseeding refreshes schedule/roster) ───
  console.log(`[5/5] Upserting Competition "${COMPETITION_ID}"...`);
  const startTs = Number.isFinite(earliestOverall)
    ? new Date(earliestOverall).toISOString()
    : new Date('2026-09-04T13:00:00.000Z').toISOString();
  const endTs = new Date('2026-09-13T20:30:00.000Z').toISOString();

  const compKeys = buildCompetitionKey({
    compId: COMPETITION_ID,
    status: 'upcoming',
    startTs,
    endTs,
  });
  const now = new Date().toISOString();

  await repo.put({
    ...compKeys,
    entityType: 'COMPETITION',
    competitionId: COMPETITION_ID,
    sport: WBWC_2026_CONFIG.sport,
    name: WBWC_2026_CONFIG.name,
    format: WBWC_2026_CONFIG.format,
    scoringRulesetId: WBWC_2026_CONFIG.scoringRulesetId,
    dataProviderId: WBWC_2026_CONFIG.dataProviderId,
    status: 'upcoming',
    rosterConfig: WBWC_2026_CONFIG.rosterConfig,
    transferRules: WBWC_2026_CONFIG.transferRules,
    chips: WBWC_2026_CONFIG.chips,
    theme: WBWC_2026_CONFIG.theme,
    schedule: { gameweeks },
    updatedAt: now,
  });
  console.log('  -> Upserted.');

  console.log('\n=== Seed Complete ===');
  console.log(
    JSON.stringify(
      {
        competitionId: COMPETITION_ID,
        sport: WBWC_2026_CONFIG.sport,
        teams: WBWC_2026_ROSTERS.length,
        players: playerItems.length,
        fixtures: fixtureItems.length,
        gameweeks: gameweeks.length,
        scoringRulesetId: SCORING_RULESET_ID,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
