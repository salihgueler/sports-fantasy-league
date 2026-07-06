# Adding a New Competition (League)

This guide walks through onboarding a new competition — a league, tournament, or
season for any sport — to the Multi-Sport Fantasy League Engine.

The platform's core design goal is that **a competition is data, not code**. A
new competition is added as configuration plus a data adapter. You do **not**
modify the scoring engine, the frontend, the API middleware, or any domain
service. The reference implementation for this whole flow is the Bundesliga
2025-26 onboarding — read it alongside this guide:

- Config: [`services/data-sync/src/competitions/bundesliga-2025.ts`](../services/data-sync/src/competitions/bundesliga-2025.ts)
- Adapter: [`services/data-sync/src/adapters/bundesliga-2025.ts`](../services/data-sync/src/adapters/bundesliga-2025.ts)
- Seed: [`scripts/seed-bundesliga.ts`](../scripts/seed-bundesliga.ts)
- Proof: [`docs/PORTABILITY_PROOF.md`](PORTABILITY_PROOF.md)

---

## What you add vs. what you never touch

**You add (configuration + data mapping only):**

| Addition | Path | Purpose |
| -------- | ---- | ------- |
| Competition config | `services/data-sync/src/competitions/<competition-id>.ts` | Roster rules, transfer rules, chips, theme, and which ruleset/adapter to use. |
| Data provider adapter | `services/data-sync/src/adapters/<competition-id>.ts` | Maps an external data source to the canonical model. |
| Seed script | `scripts/seed-<competition-id>.ts` | Writes the DynamoDB records and runs the initial sync. |

**You never touch:**

- Scoring engine (`services/scoring/`)
- Frontend (`apps/web/`)
- API middleware (`packages/shared/src/middleware/`)
- Competition / Draft / Transfer / Gameweek / League / Realtime services
- CDK infrastructure (`infra/cdk/`)

---

## Step 1 — Write the competition config

Create `services/data-sync/src/competitions/<competition-id>.ts` exporting a
`CompetitionConfig`. This record fully defines how the engine and UI treat the
competition.

```ts
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

export const MY_COMPETITION_CONFIG: CompetitionConfig = {
  sport: 'football',
  name: 'My League 2025-26',
  format: 'league', // 'tournament' | 'league' | 'playoffs'
  scoringRulesetId: 'football-standard-v1', // reuse an existing ruleset when the sport matches
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
  dataProviderId: 'my-provider-my-league-2025', // must match the adapter's providerId
  theme: {
    colorPrimary: '#D20515',
    colorAccent1: '#000000',
    colorAccent2: '#FFFFFF',
  },
};
```

Notes:

- **Reuse the ruleset when the sport matches.** Bundesliga reuses
  `football-standard-v1` — the same ruleset as the World Cup, no duplication.
- **`dataProviderId` must exactly match** the `providerId` of the adapter you
  write in Step 2.
- **`theme` drives the frontend palette.** The Web Client applies these tokens
  via a `data-competition` attribute — no component changes required.

---

## Step 2 — Write the data provider adapter

Create `services/data-sync/src/adapters/<competition-id>.ts` implementing the
[`DataProviderAdapter`](../services/data-sync/src/adapter-interface.ts)
interface. This is the boundary between the external feed and the canonical
model.

```ts
import type { Player, PlayerMatchStats } from '@fantasy/shared';
import type { DataProviderAdapter, Fixture } from '../adapter-interface.js';
import { mapToCanonicalStats } from '../canonical-stats.js';

// Map the provider's raw stat keys to the platform's canonical keys.
const STAT_MAP: Record<string, string> = {
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

export const myLeagueAdapter: DataProviderAdapter = {
  providerId: 'my-provider-my-league-2025', // must match config.dataProviderId

  async fetchRosters(competitionId: string): Promise<Player[]> {
    // Call the external API, map each player to the canonical Player shape.
    return [];
  },

  async fetchFixtures(competitionId: string): Promise<Fixture[]> {
    // Map external fixtures → canonical Fixture (gameweek, teams, kickoff, status).
    return [];
  },

  async fetchLiveScores(fixtureId: string): Promise<PlayerMatchStats[]> {
    // Map per-player match stats through STAT_MAP into canonical stat keys.
    return [];
  },

  mapToCanonicalStats(raw: unknown) {
    if (typeof raw !== 'object' || raw === null) {
      return { mapped: {}, rejected: [] };
    }
    return mapToCanonicalStats(raw as Record<string, unknown>, STAT_MAP);
  },
};
```

Notes:

- **Credentials come from Secrets Manager**, never hard-coded. See how the
  Bundesliga adapter reads `API_FOOTBALL_SECRET_NAME` and caches the result.
- **Only mapped stat keys are accepted.** `mapToCanonicalStats` returns
  `{ mapped, rejected }` so unmapped keys are surfaced rather than silently
  dropped.
- **Reuse an existing adapter when the source matches.** The Bundesliga adapter
  uses the same API-Football source as the World Cup, just a different league ID.

---

## Step 3 — Reuse or create a scoring ruleset

If the sport already has a ruleset (e.g. `football-standard-v1`), reference it
from the config and skip creating a new one. Create a new `ScoringRuleset` only
for a new sport or a genuinely different scoring model. A ruleset is a list of
`ScoringRule`s evaluated by
[`compute-player-points.ts`](../services/scoring/src/compute-player-points.ts):

- **Flat rule:** `{ stat: 'assists', points: 3 }`
- **Position-specific:** `{ stat: 'goals', position: 'DEF', points: 6 }`
- **Minutes threshold:** `{ stat: 'minutesPlayed', points: 1, conditions: { min: 60 } }`
- **Per-every-N:** `{ stat: 'saves', points: 1, conditions: { perEvery: 3 } }`

---

## Step 4 — Write the seed script

Create `scripts/seed-<competition-id>.ts` modeled on
[`scripts/seed-bundesliga.ts`](../scripts/seed-bundesliga.ts). It performs five
idempotent steps against the DynamoDB table:

1. **Ensure the `ScoringRuleset` record exists** — `conditionalPut` with
   `onlyIfNotExists`, so re-runs are no-ops.
2. **Ensure the adapter binding record exists** (`ADAPTER#<providerId>`).
3. **Ensure the `Competition` record exists** (`COMPETITION#<id>` / `META`),
   including the `GSI1PK = COMP_STATUS#upcoming` keys so it appears in the
   competition list.
4. **Register the adapter and run roster sync** — `registerAdapter(myLeagueAdapter)`
   then `syncRoster(...)`.
5. **Run fixture sync** — `syncFixtures(...)`.

Idempotency is the key property (R15.8): running the script twice produces the
same DynamoDB state — no duplicates, no stale data — because writes use
content-based conditional writes and deterministic keys.

---

## Step 5 — Run the seed and go live

```bash
# Required environment
export FANTASY_TABLE_NAME=FantasyTable
export AWS_REGION=us-east-1
export API_FOOTBALL_SECRET_NAME=fantasy/api-football   # or your provider's secret

# Seed the competition and run the initial sync
npx tsx scripts/seed-<competition-id>.ts

# Run again to prove idempotence — same output, no duplicates
npx tsx scripts/seed-<competition-id>.ts
```

The seed writes the competition with `status: 'upcoming'`, which is what makes
the UI pick it up. Seed scripts write to the **deployed** DynamoDB table, so
deploy the backend (or point at an existing table) first.

---

## How the frontend picks it up automatically

Once the competition is seeded, the Web Client renders it with **zero code
changes**, entirely from the API response:

| Aspect | Source | Behaviour |
| ------ | ------ | --------- |
| Positions | `competition.rosterConfig.positions` | Player pool and draft UI read positions dynamically — no hardcoded lists. |
| Budget | `competition.rosterConfig.budget` | Draft budget displayed and enforced from the API value. |
| Scoring | `competition.scoringRulesetId` | Scoring breakdown references the ruleset; reused across competitions. |
| Theme | `competition.theme` | Applied via a `data-competition` attribute; switches within ~100ms on navigation. |
| Chips | `competition.chips` | Chip options rendered dynamically from the array. |
| Transfers | `competition.transferRules` | Free transfers, carry-over, and penalties shown from the response. |

---

## Onboarding checklist

- [ ] Competition config added under `services/data-sync/src/competitions/`
- [ ] `dataProviderId` in the config matches the adapter's `providerId`
- [ ] Adapter added under `services/data-sync/src/adapters/` implementing all four methods
- [ ] Stat-key mapping defined; provider credentials read from Secrets Manager
- [ ] Scoring ruleset reused (same sport) or a new one created (new sport)
- [ ] Seed script added under `scripts/`, mirroring the 5 idempotent steps
- [ ] Seed run twice — second run reports "already exists / skipped" (idempotent)
- [ ] Competition `status` is `upcoming` (or `active`) so the UI lists it
- [ ] No changes to `services/scoring/`, `apps/web/`, `packages/shared/src/middleware/`, or `infra/cdk/`

If every box is checked and the only new files are a config, an adapter, and a
seed script, you have proven the platform's core promise: **a competition is
data, not code.**
