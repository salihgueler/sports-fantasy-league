# Portability Proof: Bundesliga 2025-26

## Summary

The Bundesliga 2025-26 competition was onboarded to the Multi-Sport Fantasy League Engine with **zero changes** to the scoring engine, frontend, API middleware, or any domain service. This validates design goals R16.3 (competition as configuration) and R15.8 (idempotent sync).

## What Was NOT Modified

| Layer | Path | Change | 
|-------|------|--------|
| Scoring Engine | `services/scoring/` | None |
| Frontend (Web Client) | `apps/web/` | None |
| API Middleware | `packages/shared/src/middleware/` | None |
| Competition Service | `services/competition/` | None |
| Draft Service | `services/draft/` | None |
| Transfer Service | `services/transfer/` | None |
| Gameweek Service | `services/gameweek/` | None |
| League Service | `services/league/` | None |
| Realtime Service | `services/realtime/` | None |
| CDK Infrastructure | `infra/cdk/` | None |

## What Was Added (Configuration Only)

| Addition | Path | Purpose |
|----------|------|---------|
| Adapter binding | `services/data-sync/src/adapters/bundesliga-2025.ts` | Maps API-Football (league 78) to canonical model |
| Competition config | `services/data-sync/src/competitions/bundesliga-2025.ts` | Defines roster, transfer rules, chips, and theme |
| Seed script | `scripts/seed-bundesliga.ts` | Seeds DDB records and runs initial sync |

## How the Frontend Renders Without Code Changes

The React frontend (`apps/web/`) is entirely configuration-driven:

1. **Positions** — The player pool and draft UI reads `competition.rosterConfig.positions` from the API. For Bundesliga: `[GK, DEF, MID, FWD]` with the same min/max as World Cup. No hardcoded position lists.

2. **Budget** — The draft budget constraint is `competition.rosterConfig.budget` (100). The frontend displays and enforces this value directly from the API response.

3. **Scoring rules** — The scoring breakdown references `competition.scoringRulesetId` (`football-standard-v1`). The same ruleset used by World Cup is reused without duplication.

4. **Theme** — CSS custom properties are applied from `competition.theme`:
   - `--color-primary: #D20515` (Bundesliga red)
   - `--color-accent-1: #000000`
   - `--color-accent-2: #FFFFFF`
   
   The Web Client applies these via a `data-competition` attribute on the root element (R4.1, R4.5). Theme switching happens within 100ms when the user navigates to a different competition.

5. **Chips** — The available chips (`WILDCARD`, `TRIPLE_CAPTAIN`, `BENCH_BOOST`, `FREE_HIT`) are read from `competition.chips`. The UI dynamically renders chip options from this array.

6. **Transfer rules** — Free transfers per gameweek, carry-over limit, and penalty points are all from `competition.transferRules`. The frontend displays these constraints from the response data.

## Idempotent Sync Verification (R15.8)

The seed script (`scripts/seed-bundesliga.ts`) demonstrates idempotent sync:

- **Roster sync** uses content-based conditional writes. Running the script twice produces the same DynamoDB state — no duplicates, no stale data.
- **Fixture sync** uses deterministic keys derived from `competitionId + gameweek + fixtureId`. Reprocessing the same input yields identical persisted state.
- **ScoringRuleset and Competition records** use `conditionalPut` with `onlyIfNotExists`, ensuring repeated runs are no-ops.

## How to Validate

```bash
# Set environment variables
export FANTASY_TABLE_NAME=FantasyTable
export AWS_REGION=us-east-1
export API_FOOTBALL_SECRET_NAME=fantasy/api-football

# Run the seed script
npx tsx scripts/seed-bundesliga.ts

# Run again to prove idempotence — same output, no duplicates
npx tsx scripts/seed-bundesliga.ts
```

After seeding, the Web Client will:
1. Show "Bundesliga 2025-26" in the competition list (via `GET /competitions`)
2. Apply the red/black/white theme automatically
3. Display all players, fixtures, and scoring rules from the seeded data
4. Require zero redeployment of frontend logic

## Conclusion

Adding the Bundesliga required only:
- **1 adapter file** (maps API-Football league 78 to the canonical model)
- **1 config file** (defines roster/transfer/chip/theme configuration)
- **1 seed script** (demonstration only — in production, this would be a CLI or admin API call)

This proves the platform's core design goal: **a competition is data, not code**.
