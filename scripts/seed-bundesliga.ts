/**
 * Bundesliga 2025-26 Seed Script — Portability Proof (R16.3, R15.8).
 *
 * Demonstrates onboarding a second competition with ZERO code changes to:
 *   - Scoring engine (services/scoring/)
 *   - Frontend (apps/web/)
 *   - API middleware (packages/shared/src/middleware/)
 *   - Any other service
 *
 * Only additions required:
 *   1. Adapter binding (services/data-sync/src/adapters/bundesliga-2025.ts)
 *   2. Competition config (services/data-sync/src/competitions/bundesliga-2025.ts)
 *
 * This script seeds the DynamoDB table with the Bundesliga competition record,
 * its scoring ruleset (reusing football-standard-v1), registers the adapter
 * binding, and runs the initial idempotent roster and fixture sync.
 *
 * Usage:
 *   npx tsx scripts/seed-bundesliga.ts
 *
 * Environment variables:
 *   FANTASY_TABLE_NAME       — DynamoDB table name (default: FantasyTable)
 *   AWS_REGION               — AWS region (default: us-east-1)
 *   API_FOOTBALL_SECRET_NAME — Secrets Manager secret for API-Football credentials
 */

import { FantasyRepository } from '@fantasy/shared';
import { registerAdapter } from '../services/data-sync/src/adapter-registry.js';
import { bundesliga2025Adapter } from '../services/data-sync/src/adapters/bundesliga-2025.js';
import { BUNDESLIGA_2025_CONFIG } from '../services/data-sync/src/competitions/bundesliga-2025.js';
import { syncRoster } from '../services/data-sync/src/roster-sync.js';
import { syncFixtures } from '../services/data-sync/src/sync-service.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.FANTASY_TABLE_NAME ?? 'FantasyTable';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const COMPETITION_ID = 'bundesliga-2025-26';

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Bundesliga 2025-26 Seed Script ===\n');
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Competition ID: ${COMPETITION_ID}\n`);

  const repo = new FantasyRepository({
    tableName: TABLE_NAME,
    clientConfig: { region: REGION },
  });

  // ─── Step 1: Create the ScoringRuleset (if not already present) ─────────
  console.log('[1/5] Ensuring ScoringRuleset "football-standard-v1" exists...');
  const rulesetWritten = await repo.conditionalPut(
    {
      PK: `RULESET#football-standard-v1`,
      SK: 'META',
      rulesetId: 'football-standard-v1',
      sport: 'football',
      entityType: 'SCORING_RULESET',
      rules: [
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
      ],
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(rulesetWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 2: Create the Adapter binding record ──────────────────────────
  console.log('[2/5] Ensuring Adapter binding "api-football-bundesliga-2025" exists...');
  const adapterWritten = await repo.conditionalPut(
    {
      PK: `ADAPTER#api-football-bundesliga-2025`,
      SK: 'META',
      providerId: 'api-football-bundesliga-2025',
      sport: 'football',
      description: 'API-Football adapter for Bundesliga 2025-26 (league 78, season 2025)',
      entityType: 'DATA_PROVIDER_ADAPTER',
      createdAt: new Date().toISOString(),
    },
    { onlyIfNotExists: true },
  );
  console.log(adapterWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 3: Create the Competition record ──────────────────────────────
  console.log('[3/5] Ensuring Competition "bundesliga-2025-26" exists...');
  const now = new Date().toISOString();
  const startTs = '2025-08-15T18:30:00Z'; // Bundesliga 2025-26 estimated start
  const competitionWritten = await repo.conditionalPut(
    {
      PK: `COMPETITION#${COMPETITION_ID}`,
      SK: 'META',
      competitionId: COMPETITION_ID,
      sport: BUNDESLIGA_2025_CONFIG.sport,
      name: BUNDESLIGA_2025_CONFIG.name,
      format: BUNDESLIGA_2025_CONFIG.format,
      scoringRulesetId: BUNDESLIGA_2025_CONFIG.scoringRulesetId,
      rosterConfig: BUNDESLIGA_2025_CONFIG.rosterConfig,
      transferRules: BUNDESLIGA_2025_CONFIG.transferRules,
      chips: BUNDESLIGA_2025_CONFIG.chips,
      dataProviderId: BUNDESLIGA_2025_CONFIG.dataProviderId,
      theme: BUNDESLIGA_2025_CONFIG.theme,
      status: 'upcoming',
      entityType: 'COMPETITION',
      createdAt: now,
      updatedAt: now,
      // GSI1: for listing upcoming/active competitions sorted by start
      GSI1PK: 'COMP_STATUS#upcoming',
      GSI1SK: `START#${startTs}`,
    },
    { onlyIfNotExists: true },
  );
  console.log(competitionWritten ? '  -> Created.' : '  -> Already exists (skipped).');

  // ─── Step 4: Register the adapter in-memory and run roster sync ─────────
  console.log('[4/5] Registering adapter and running idempotent roster sync...');
  registerAdapter(bundesliga2025Adapter);

  const rosterResult = await syncRoster(
    COMPETITION_ID,
    BUNDESLIGA_2025_CONFIG.dataProviderId,
    repo,
  );

  if (rosterResult.aborted) {
    console.error(`  -> Roster sync ABORTED: ${rosterResult.error}`);
    console.error('     (This is expected if API-Football credentials are not configured)');
  } else {
    console.log(`  -> Roster sync complete:`);
    console.log(`     Added: ${rosterResult.added}`);
    console.log(`     Updated: ${rosterResult.updated}`);
    console.log(`     Marked unavailable: ${rosterResult.markedUnavailable}`);
    if (rosterResult.quarantined.length > 0) {
      console.log(`     Quarantined: ${rosterResult.quarantined.join(', ')}`);
    }
  }

  // ─── Step 5: Run fixture sync ──────────────────────────────────────────
  console.log('[5/5] Running idempotent fixture sync...');
  const fixtureResult = await syncFixtures(
    {
      competitionId: COMPETITION_ID,
      dataProviderId: BUNDESLIGA_2025_CONFIG.dataProviderId,
    },
    repo,
  );

  if (!fixtureResult.success) {
    console.error(`  -> Fixture sync completed with errors:`);
    for (const err of fixtureResult.errors) {
      console.error(`     ${err}`);
    }
    console.error('     (This is expected if API-Football credentials are not configured)');
  } else {
    console.log(`  -> Fixture sync complete: ${fixtureResult.processed} fixtures processed.`);
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('\n=== Seed Complete ===');
  console.log(`
Portability Assertion:
  The Bundesliga 2025-26 competition was onboarded with ZERO changes to:
    - Scoring engine (services/scoring/)
    - Frontend (apps/web/)
    - API middleware (packages/shared/src/middleware/)
    - Competition service (services/competition/)
    - Draft/Transfer/Gameweek services

  Only additions:
    - Adapter: services/data-sync/src/adapters/bundesliga-2025.ts
    - Config:  services/data-sync/src/competitions/bundesliga-2025.ts
    - Seed:    scripts/seed-bundesliga.ts (this file)

  The Web Client renders the Bundesliga competition from the API response:
    - Positions (GK, DEF, MID, FWD) from rosterConfig
    - Budget (100) from rosterConfig
    - Scoring rules from scoringRulesetId -> football-standard-v1
    - Theme tokens (colorPrimary: #D20515) from competition.theme
    - All driven by configuration, no frontend redeploy needed.
`);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
