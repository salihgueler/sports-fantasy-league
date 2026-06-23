# Multi-Sport Fantasy League Engine

A production-minded, config-driven fantasy sports platform. It launches with the
**FIFA World Cup 2026** and is architected so that a new competition — Bundesliga,
Premier League, NBA, and beyond — is **a configuration, not a rewrite**.

Users draft fantasy squads, score points from real player performance, make
transfers, compete in public or private leagues, and follow live match-day
scoring. Adding a new sport or competition requires no frontend code changes:
the UI renders dynamically from each competition's roster, transfer, and scoring
configuration.

---

## Highlights

- **Multi-tenant, multi-sport** — competitions are data. The portability layer is
  the `Competition` record (roster config, transfer rules, scoring ruleset, chips).
- **Serverless AWS backend** — Lambda services behind API Gateway (REST + WebSocket),
  a single-table DynamoDB design, EventBridge + Step Functions for async scoring
  and data sync, all provisioned with AWS CDK v2.
- **Typed end-to-end** — TypeScript everywhere; domain types and Zod schemas are
  shared between services and the web app via `@fantasy/shared`.
- **Modern React frontend** — React 18 + Vite + Tailwind, with the "Matchday"
  shadcn/ui design system (Kit Blue / Pitch Green / Strike Red brand palette).

---

## Tech stack

| Layer        | Technologies                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS v3, shadcn/ui (Radix), TanStack Query, Zustand, React Router          |
| **Backend**  | AWS Lambda, API Gateway (REST + WebSocket), DynamoDB (single-table), EventBridge, Step Functions, SQS, Cognito |
| **Infra**    | AWS CDK v2 (TypeScript), CloudFront, Secrets Manager                                                           |
| **Shared**   | TypeScript, Zod, AWS SDK v3, `aws-jwt-verify`                                                                  |
| **Tooling**  | npm workspaces, ESLint (`@typescript-eslint`), Prettier, `tsx`, GitHub Actions                                 |

---

## Monorepo layout

This is an npm-workspaces monorepo (`packages/*`, `apps/*`, `infra/*`, `services/*`).

```
sports-fantasy-league/
├── apps/
│   └── web/                  # React + Vite frontend (@fantasy/web)
│       └── src/
│           ├── components/   # Shared UI + components/ui (shadcn kit)
│           ├── hooks/        # use-api, use-websocket, use-theme, ...
│           ├── lib/          # api-client, auth, ws-client, utils
│           ├── pages/        # Routed pages (Competitions, Squad, Live, ...)
│           ├── stores/       # Zustand stores (auth)
│           ├── App.tsx       # App shell (nav + tricolor stripe)
│           └── main.tsx      # Router + providers entry
│
├── services/                 # Backend Lambda services (one workspace each)
│   ├── api-gateway/          # Dispatcher Lambda — routes by path prefix
│   ├── auth/                 # Cognito sign-up/in/verify, token refresh
│   ├── competition/          # Competition CRUD, fixtures
│   ├── draft/                # Fantasy teams, squad builder, auto-pick, player pool
│   ├── transfer/             # Transfers, free-transfer accounting
│   ├── gameweek/             # Gameweek state, chip activation
│   ├── league/               # Leagues, membership, standings, chat, H2H
│   ├── profile/              # User profiles & preferences
│   ├── scoring/              # Scoring engine (compute player/team points)
│   ├── data-sync/            # External data sync (openfootball World Cup)
│   └── realtime/             # WebSocket connection/broadcast handlers
│
├── packages/
│   └── shared/               # @fantasy/shared — types, Zod schemas, DB layer, middleware
│       └── src/
│           ├── types.ts      # Core domain types (Competition, Player, ...)
│           ├── schemas.ts    # Zod validation schemas
│           ├── db/           # Single-table key builders + typed repository
│           └── middleware/   # createHandler, JWT auth, envelope, logger, CORS, rate-limit
│
├── infra/
│   └── cdk/                  # @fantasy/infra — AWS CDK v2 app
│       └── src/
│           ├── bin/app.ts    # CDK entry → RootStack(FantasyLeague-<stage>)
│           ├── config/       # Stage config (dev, prod)
│           └── lib/          # Nested stacks (dynamodb, auth, api, websocket, scoring, ...)
│
├── scripts/                  # Seed scripts (seed-worldcup.ts, seed-bundesliga.ts)
├── docs/                     # PORTABILITY_PROOF.md and design notes
├── spec.md                   # Original product/architecture spec (aspirational)
└── .kiro/specs/              # Structured requirements / design / tasks
```

> Note: `spec.md` describes the original target design (it references `frontend/`
> and `backend/` folders). The **actual** implemented structure is the one shown
> above — services-per-workspace with a single API Gateway dispatcher.

---

## Prerequisites

- **Node.js ≥ 20** and npm (workspaces enabled)
- For backend deploys: an **AWS account**, configured credentials, and a
  CDK-bootstrapped environment (`npx cdk bootstrap`)

---

## Getting started

```bash
# 1. Install all workspace dependencies from the repo root
npm install

# 2. Build everything (shared must build before services/web that import it)
npm run build

# 3. Run the web app (Vite dev server on http://localhost:3000)
npm run dev --workspace=apps/web
```

### Frontend configuration

The web app reads the API base URL from a Vite env var. Create
`apps/web/.env.local`:

```bash
VITE_API_URL=https://<rest-api-id>.execute-api.us-east-1.amazonaws.com/dev
```

If `VITE_API_URL` is unset, requests are made against a relative path (useful
when a dev proxy or same-origin deployment is in place).

### Seeding competition data

```bash
# Seed World Cup 2026 (fixtures, players, competition config) into DynamoDB
npm run seed:worldcup

# Bundesliga seed (portability demonstration)
npx tsx scripts/seed-bundesliga.ts
```

Seed scripts write to the deployed DynamoDB table, so deploy the backend (or
point at an existing table) first.

---

## Backend & deployment

The backend is provisioned with AWS CDK. A single `RootStack` composes nested
stacks for DynamoDB, Cognito, the REST + WebSocket APIs, EventBridge schedules,
Step Functions, SQS, CloudFront, and the daily score sync.

```bash
cd infra/cdk

# One-time per account/region
npx cdk bootstrap

# Synthesize / deploy for a stage (dev is the default)
npx cdk synth  -c stage=dev
npx cdk deploy -c stage=dev
```

Stages are defined in `infra/cdk/src/config/environments.ts`:

| Stage           | Region      | Notes                                                    |
| --------------- | ----------- | -------------------------------------------------------- |
| `dev` (default) | `us-east-1` | Local/CI testing; CORS allows `localhost:3000` / `:5173` |
| `prod`          | `us-east-1` | Production; locked-down CORS origins                     |

The stack is named `FantasyLeague-<stage>` (e.g. `FantasyLeague-dev`). Stage is
resolved from the `-c stage=` context flag or the `DEPLOY_STAGE` env var,
defaulting to `dev`.

---

## Architecture

### Request flow

```
        React (Vite)  ──HTTPS──▶  API Gateway (REST)  ──▶  api-gateway dispatcher Lambda
              │                                                      │ routes by path prefix
              │                                                      ▼
              │                        ┌──────── auth · competition · draft · transfer ────────┐
              │                        │         gameweek · league · profile  (Lambdas)        │
              │                        └───────────────────────────┬───────────────────────────┘
              │                                                     ▼
              │                                   DynamoDB (single-table + GSIs)
              │
              └──WebSocket──▶ API Gateway (WS) ──▶ realtime service ──▶ live score/chat push

   EventBridge (schedules) ──▶ data-sync / scoring (Step Functions) ──▶ DynamoDB ──▶ EventBridge events
```

### API Gateway dispatcher

A **single dispatcher Lambda** (`services/api-gateway`) sits behind a catch-all
proxy route and forwards each request to the owning service handler based on the
**path prefix**. The proxy route itself uses `authorizationType: NONE` — every
service **self-enforces auth** through the shared JWT-verification middleware.

Routing rules (order matters — specific before generic):

| Path                     | Service                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `/auth/*`                | auth                                                                                                     |
| `/profile`, `/profile/*` | profile                                                                                                  |
| `/leagues*`              | league                                                                                                   |
| `/gameweeks*`            | gameweek                                                                                                 |
| `/transfers`             | transfer                                                                                                 |
| `/teams`, `/teams/*`     | draft (except `…/chips` → gameweek)                                                                      |
| `/competitions*`         | competition (except `…/players` → draft, `…/grant-transfers` → transfer, `POST …/sync` → World Cup sync) |

### API response envelope

Every response uses a consistent envelope:

```jsonc
// Success
{ "success": true, "data": { /* ... */ }, "meta": { "requestId": "uuid", "timestamp": "ISO-8601" } }

// Error
{ "success": false, "error": { "code": "TRANSFER_DEADLINE_PASSED", "message": "…", "details": {} }, "meta": { /* ... */ } }
```

The frontend `apiClient` unwraps `data` on success and throws a structured
`ApiClientError` on failure (with a single automatic token-refresh retry on 401).

### Data persistence

A single DynamoDB table holds all entities (`PK`/`SK` plus `GSI1`–`GSIn` for
access patterns: standings, memberships, player pools, leaderboards). Key
builders and a typed repository live in `packages/shared/src/db`.

---

## Core data model

The portability layer is the **`Competition`** record — it carries everything the
generic engine needs to run any sport:

```ts
interface Competition {
  competitionId: string; // "world-cup-2026", "bundesliga-2425"
  sport: 'football' | 'basketball' | 'baseball' | 'cricket';
  name: string;
  format: 'tournament' | 'league' | 'playoffs';
  scoringRulesetId: string; // → pluggable ScoringRuleset
  rosterConfig: RosterConfig; // positions, squadSize, budget, captainMultiplier, perTeamCap
  transferRules: TransferRules; // free transfers, penalties, carry-over
  schedule: { gameweeks: Gameweek[] };
  chips: ChipType[]; // WILDCARD | TRIPLE_CAPTAIN | BENCH_BOOST | FREE_HIT
  status: 'draft' | 'upcoming' | 'active' | 'completed';
  dataProviderId: string;
  theme?: ThemeTokens; // optional per-competition palette
}
```

Other core entities (full definitions in `packages/shared/src/types.ts`):
`Player`, `FantasyTeam` / `SquadSlot`, `League`, `StandingsEntry`,
`ScoringRuleset` / `ScoringRule`, `Gameweek`, `ChatMessage`, `UserProfile`.

### Adding a new competition

1. Create a `Competition` record (sport, format, roster config, transfer rules, chips).
2. Create or reuse a `ScoringRuleset` for that sport.
3. Provide a data-sync path for rosters/fixtures/scores (see `services/data-sync`).
4. Seed initial rosters and fixtures (see `scripts/`).
5. Set the competition `status` to `upcoming` — the UI picks it up automatically.

No frontend code changes are required; pages render from competition config.
See [`docs/PORTABILITY_PROOF.md`](docs/PORTABILITY_PROOF.md).

---

## Commands

Run from the repo root unless noted.

| Action                 | Command                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Install everything     | `npm install`                                                                               |
| Build all workspaces   | `npm run build`                                                                             |
| Build one workspace    | `npm run build --workspace=apps/web` (or `services/<name>`, `packages/shared`, `infra/cdk`) |
| Lint                   | `npm run lint`                                                                              |
| Format (write)         | `npm run format`                                                                            |
| Format (check)         | `npm run format:check`                                                                      |
| Web dev server         | `npm run dev --workspace=apps/web` (port 3000)                                              |
| Type-check the web app | `npm run build --workspace=apps/web` (runs `tsc --noEmit && vite build`)                    |
| Seed World Cup data    | `npm run seed:worldcup`                                                                     |
| CDK synth              | `cd infra/cdk && npx cdk synth -c stage=dev`                                                |
| CDK deploy             | `cd infra/cdk && npx cdk deploy -c stage=dev`                                               |

> Backend services compile with `tsc`. There is no separate `typecheck` script —
> `npm run build` is the type-check for services and `packages/shared`.

---

## Continuous integration

`.github/workflows/ci.yml` runs on pushes/PRs to `main` and `develop`:

1. **build** — `npm ci` → `npm run lint` → `npm run format:check` → `npm run build`
2. **bundle-size** — builds the web app and checks against `bundlesize` budgets
3. **lighthouse** — runs Lighthouse CI against the built web app

---

## Further documentation

- [`spec.md`](spec.md) — original product vision and architecture spec
- [`docs/PORTABILITY_PROOF.md`](docs/PORTABILITY_PROOF.md) — adding a second competition
- [`.kiro/specs/multi-sport-fantasy-league/`](.kiro/specs/multi-sport-fantasy-league/) — requirements, design, tasks
- [`AGENTS.md`](AGENTS.md) — conventions and guardrails for AI coding agents
