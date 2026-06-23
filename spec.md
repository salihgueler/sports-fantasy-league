# Project Spec: Multi-Sport Fantasy League Engine

## Vision

Build a production-ready, extensible fantasy league platform that launches with **FIFA World Cup 2026** and is architecturally portable to any league or sport (Bundesliga, Premier League, NBA, Euroleague, and beyond). The system inverts the typical "tournament-locked" architecture into a **multi-tenant, multi-sport engine** where a new competition is a configuration — not a rewrite.

---

## Objective

| Question                         | Answer                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What does the system do?**     | Lets users draft fantasy teams, score points based on real player performance, manage transfers, compete in leagues, and track leaderboards — across any supported competition.                                |
| **Who is the user?**             | Sports fans who participate in fantasy leagues (casual to competitive). Initial audience: World Cup 2026 fans.                                                                                                 |
| **What does success look like?** | A user can create a league, draft players from the World Cup, watch scores update daily, and — without code changes — the platform operator can add a new sport/competition and users get the same experience. |

---

## Tech Stack

### Frontend

- **React** with TypeScript
- **Vite** (build tooling)
- **Tailwind CSS** (utility-first styling)
- **React Query (TanStack Query)** for server state
- **React Router** for routing
- **Zustand** for client state
- Agent Skills:
  - `vercel-react-best-practices` — 70 performance rules across 8 categories (server perf, bundle optimization, re-render avoidance, hydration patterns)
  - `frontend-design` (Anthropic) — distinctive, production-grade interfaces; bold aesthetic direction; avoid generic AI slop

### Design System & Color Palettes

The app uses a **competition-driven theming system** — the color palette changes based on the active competition. Each competition defines its own theme via CSS custom properties.

#### World Cup 2026 Theme (Default)

Based on the official FIFA World Cup 2026 brand identity — a tri-nation palette representing the three host countries (USA 🇺🇸, Canada 🇨🇦, Mexico 🇲🇽):

| Role                      | Color                | Hex       | Usage                                                                              |
| ------------------------- | -------------------- | --------- | ---------------------------------------------------------------------------------- |
| **Primary Blue** (USA)    | Dark Cornflower Blue | `#2A398D` | Primary CTA buttons, navigation bar, active states                                 |
| **Accent Red** (Canada)   | Torch Red            | `#E61D25` | Alerts, live match indicators, captain badge, negative point changes               |
| **Accent Green** (Mexico) | Average Green        | `#3CAC3B` | Success states, positive point changes, available status, pitch-themed backgrounds |
| **Gold**                  | Trophy Gold          | `#D4AF37` | Rankings #1 spot, premium badges, trophy/achievement icons                         |
| **Neutral Light**         | Light Gray           | `#D1D4D1` | Card backgrounds, dividers, disabled states                                        |
| **Neutral Dark**          | Dark Heather Grey    | `#474A4A` | Body text, secondary labels                                                        |
| **Surface**               | White                | `#FFFFFF` | Page background, card surfaces                                                     |
| **Background**            | Off-Black            | `#1A1A2E` | Dark mode base, hero sections                                                      |

```css
/* Competition theme: World Cup 2026 */
[data-competition="wc-2026"] {
  --color-primary: #2a398d;
  --color-accent-1: #e61d25;
  --color-accent-2: #3cac3b;
  --color-gold: #d4af37;
  --color-neutral-light: #d1d4d1;
  --color-neutral-dark: #474a4a;
  --color-surface: #ffffff;
  --color-background: #1a1a2e;
}
```

#### Other Competition Themes (Examples)

| Competition        | Primary               | Accent 1             | Accent 2  | Notes                        |
| ------------------ | --------------------- | -------------------- | --------- | ---------------------------- |
| **Bundesliga**     | `#D20515` (DFL Red)   | `#000000`            | `#FFFFFF` | Bold red + monochrome        |
| **Premier League** | `#3D195B` (PL Purple) | `#00FF87` (PL Green) | `#FFFFFF` | The iconic purple/neon combo |
| **NBA**            | `#1D428A` (NBA Blue)  | `#C8102E` (NBA Red)  | `#FFFFFF` | Classic league branding      |
| **Euroleague**     | `#F68E1E` (EL Orange) | `#003DA5`            | `#FFFFFF` | Orange-dominant sports feel  |

#### Theming Rules

- Competition theme is set via a `data-competition` attribute on the root element
- All component colors reference CSS custom properties (never hard-coded hex values)
- Adding a new competition theme = adding one CSS variable block (no component changes)
- Dark mode inverts `--color-surface` and `--color-background`, keeps accent colors
- Typography uses **Noto Sans** (matches FIFA's secondary typeface choice) as the workhorse, with a bold geometric display font for headings

### Backend (AWS Serverless)

- **AWS Lambda** (compute)
- **Amazon API Gateway** (HTTP/WebSocket APIs)
- **Amazon DynamoDB** (primary data store — single-table design with GSIs for all access patterns including standings, historical stats, and leaderboard queries)
- **Amazon EventBridge** (event bus for async workflows)
- **AWS Step Functions** (orchestration for scoring pipeline, roster sync)
- **Amazon SQS** (buffering game-day traffic spikes)
- **Amazon S3** (static assets, data exports)
- **Amazon CloudFront** (CDN for frontend + API caching)
- **Amazon Cognito** (authentication & user pools)
- **AWS Secrets Manager** (API keys for external data providers)
- Agent Skills (from [`aws/agent-toolkit-for-aws`](https://github.com/aws/agent-toolkit-for-aws)):
  - `aws-core` plugin — service selection, CDK/CloudFormation, serverless, containers, storage, observability, billing, SDK usage, and deployment
  - `aws-agents` plugin — building AI agents on AWS with Amazon Bedrock and AgentCore
  - AWS MCP Server — full AWS API coverage through a single authenticated endpoint, sandboxed script execution, real-time documentation access

### Data Sources

- **[openfootball/worldcup.json](https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json)** — World Cup 2026 fixtures, groups, results (open data, JSON format)
- **API-Football (api-football.com)** — Bundesliga, Premier League rosters, live scores, fixtures
- **BallDontLie / SportsData.io** — NBA, Euroleague stats
- Fallback: **ESPN public API** / web scraping layer

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                  │
│  Landing · Draft Room · My Team · Leaderboard · Live Scores │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                  API Gateway (REST + WS)                     │
└──┬──────────┬──────────┬──────────┬──────────┬──────────────┘
   │          │          │          │          │
┌──▼──┐  ┌───▼───┐  ┌───▼───┐  ┌──▼───┐  ┌──▼──────────┐
│Auth │  │League │  │Draft  │  │Score │  │Data Sync    │
│Svc  │  │Svc    │  │Svc    │  │Svc   │  │(Step Funcs) │
└──┬──┘  └───┬───┘  └───┬───┘  └──┬───┘  └──┬──────────┘
   │          │          │         │          │
   ▼          ▼          ▼         ▼          ▼
┌─────────────────────────────────────────────────────────────┐
│              DynamoDB (single-table design + GSIs)           │
└─────────────────────────────────────────────────────────────┘
         │                              │
    EventBridge                    SQS (spike buffer)
         │
┌────────▼────────┐
│  Scoring Engine  │ ← triggered by EventBridge schedule
│  (Step Function) │     or real-time webhook
└─────────────────┘
```

---

## Project Structure

```
fantasy-league/
├── frontend/
│   ├── src/
│   │   ├── components/        # Shared UI components
│   │   ├── features/          # Feature-sliced modules
│   │   │   ├── auth/
│   │   │   ├── draft/
│   │   │   ├── league/
│   │   │   ├── team/
│   │   │   ├── scoring/
│   │   │   └── leaderboard/
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utilities, API client
│   │   ├── stores/            # Zustand stores
│   │   ├── types/             # Shared TypeScript types
│   │   └── App.tsx
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── backend/
│   ├── lib/                   # CDK stacks
│   │   ├── api-stack.ts
│   │   ├── auth-stack.ts
│   │   ├── table-stack.ts     # DynamoDB table + GSIs
│   │   ├── scoring-stack.ts
│   │   └── sync-stack.ts
│   ├── functions/
│   │   ├── api/               # Lambda handlers (per-route)
│   │   ├── scoring/           # Scoring engine lambdas
│   │   ├── sync/              # Data sync lambdas
│   │   └── shared/            # Shared utils, DB clients
│   ├── models/                # Data models & schemas
│   │   ├── competition.ts     # Sport-agnostic competition model
│   │   ├── player.ts
│   │   ├── team.ts
│   │   ├── league.ts
│   │   ├── fixture.ts
│   │   └── scoring-rules.ts   # Pluggable scoring per sport
│   └── cdk.json
├── shared/                    # Types shared between FE & BE
│   └── types/
├── scripts/                   # Dev utilities, seed data
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   └── SCORING_RULES.md
├── .github/workflows/
├── spec.md                    # This file
└── README.md
```

---

## Core Data Model (Sport-Agnostic)

### Competition (the portability layer)

```typescript
interface Competition {
  competitionId: string; // "wc-2026", "bundesliga-2425", "nba-2526"
  sport: Sport; // "football" | "basketball" | ...
  name: string; // "FIFA World Cup 2026"
  format: CompetitionFormat; // "tournament" | "league" | "playoffs"
  scoringRulesetId: string; // FK to scoring rules
  rosterConfig: RosterConfig; // positions, squad size, budget
  transferRules: TransferRules; // windows, free transfers per GW
  schedule: ScheduleConfig; // gameweeks, deadlines
  status: "upcoming" | "active" | "completed";
  dataProviderId: string; // which API feeds this competition
}

type Sport = "football" | "basketball" | "baseball" | "cricket";

interface RosterConfig {
  positions: Position[]; // e.g., [{name: "GK", min: 1, max: 2}, ...]
  squadSize: number; // e.g., 15
  startingXI: number; // e.g., 11
  budget: number; // e.g., 100.0 (millions)
  captainMultiplier: number; // e.g., 2
}
```

### Player

```typescript
interface Player {
  playerId: string;
  competitionId: string;
  externalId: string; // ID from data provider
  name: string;
  nationality: string;
  teamId: string; // Real-world team
  position: string; // Sport-specific position
  price: number; // Current fantasy price
  priceHistory: PricePoint[];
  availability: "available" | "injured" | "suspended" | "doubtful";
  stats: Record<string, number>; // Flexible stat map per sport
  totalPoints: number;
  pointsPerGame: number;
  updatedAt: string; // ISO timestamp
}
```

### Fantasy Team

```typescript
interface FantasyTeam {
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  competitionId: string;
  name: string;
  squad: SquadSlot[]; // playerId + isCaptain + isViceCaptain + isBenched
  formation: string; // e.g., "4-4-2"
  budget: number; // Remaining budget
  transfers: TransferRecord[];
  totalPoints: number;
  gameweekPoints: Record<string, number>;
}
```

### League

```typescript
interface League {
  leagueId: string;
  competitionId: string;
  name: string;
  type: "public" | "private";
  createdBy: string; // userId
  joinCode?: string;
  maxMembers: number;
  scoring: "classic" | "head-to-head";
  members: LeagueMember[];
}
```

### Scoring Rules (pluggable per sport)

```typescript
interface ScoringRuleset {
  rulesetId: string;
  sport: Sport;
  competitionId?: string; // null = default for sport
  rules: ScoringRule[];
}

interface ScoringRule {
  stat: string; // "goals", "assists", "rebounds", "three_pointers"
  position?: string; // Position-specific bonus (optional)
  points: number; // Points awarded per unit
  conditions?: ScoringCondition[];
}

// Example: Football (World Cup)
const worldCupScoring: ScoringRule[] = [
  { stat: "minutes_played", points: 1, conditions: [{ min: 60 }] },
  { stat: "goals", position: "FWD", points: 4 },
  { stat: "goals", position: "MID", points: 5 },
  { stat: "goals", position: "DEF", points: 6 },
  { stat: "goals", position: "GK", points: 6 },
  { stat: "assists", points: 3 },
  { stat: "clean_sheet", position: "GK", points: 4 },
  { stat: "clean_sheet", position: "DEF", points: 4 },
  { stat: "saves", position: "GK", points: 1, conditions: [{ perEvery: 3 }] },
  { stat: "penalty_saved", points: 5 },
  { stat: "penalty_missed", points: -2 },
  { stat: "yellow_cards", points: -1 },
  { stat: "red_cards", points: -3 },
  { stat: "own_goals", points: -2 },
];
```

---

## Features (MVP — World Cup 2026)

### 1. Authentication & User Management

- Sign up / sign in (email + social via Cognito)
- User profile (display name, avatar, notification preferences)
- Session management (JWT, refresh tokens)

### 2. Competition Hub

- Browse active/upcoming competitions
- Competition detail page (rules, schedule, scoring breakdown)
- Global & competition-specific leaderboards

### 3. Squad Builder / Draft

- Browse all players with filters (team, position, price, points, availability)
- Player detail card (stats, price history chart, upcoming fixtures)
- Auto-pick (fill remaining slots optimally within budget)
- Formation selector (validates position constraints)
- Captain / Vice-captain selection
- Budget enforcement (hard constraint, no overdraft)

### 4. Transfers

- Transfer market with search/filter
- Free transfers per gameweek (configurable per competition)
- Transfer cost for additional transfers (point hit)
- Wildcard chip (unlimited free transfers, limited uses)
- Transfer deadline countdown (enforced server-side)

### 5. Scoring & Live Updates

- Daily scoring job (Step Function triggered by EventBridge Scheduler)
- Live match day scoring via WebSocket push
- Breakdown: per-player, per-stat points
- Bonus points calculation (e.g., BPS in FPL-style)
- Provisional → Confirmed score lifecycle

### 6. Leagues

- Create private leagues (invite via share code)
- Join public leagues
- League standings (classic ranking or H2H tables)
- Mini-leagues (auto-created: e.g., country-based)
- League chat (basic messaging)

### 7. Gameweek Management

- Gameweek deadline management
- Auto-substitution rules (if a starting player doesn't play)
- Chip system: Wildcard, Triple Captain, Bench Boost (configurable per competition)

### 8. Data Sync Pipeline (Background Jobs)

- **Roster Sync** — Daily job (03:00 UTC) fetches latest rosters from data provider
  - Detects new players, transfers between teams, injuries, suspensions
  - Updates player availability and price
- **Score Sync** — Runs every 5 minutes during live match windows; daily at 06:00 UTC for reconciliation
  - Fetches match stats → applies scoring rules → updates player & team points
  - Publishes `ScoreUpdated` event to EventBridge
- **Fixture Sync** — Daily at 02:00 UTC
  - Updates fixture schedule (kickoff times, venue changes, postponements)
- **Price Change Engine** — Daily at 04:00 UTC
  - Calculates player price changes based on transfer activity (supply/demand algorithm)

---

## Portability: Adding a New Competition

To add a new competition (e.g., Bundesliga 2025-26):

1. **Define Competition Config** — Create a `Competition` record with sport, format, roster config, transfer rules
2. **Define Scoring Ruleset** — Create or reuse a `ScoringRuleset` for that sport
3. **Configure Data Provider Adapter** — Implement `DataProviderAdapter` interface:
   ```typescript
   interface DataProviderAdapter {
     fetchRosters(competitionId: string): Promise<Player[]>;
     fetchFixtures(competitionId: string): Promise<Fixture[]>;
     fetchLiveScores(fixtureId: string): Promise<PlayerMatchStats[]>;
     mapToCanonicalStats(raw: any): Record<string, number>;
   }
   ```
4. **Seed Data** — Run initial roster + fixture sync
5. **Enable** — Set competition status to `"upcoming"` → UI automatically shows it

**Zero frontend code changes required for a new competition.** The UI renders dynamically based on competition config (positions, rules, chips).

---

## Commands

| Action                      | Command                                                  |
| --------------------------- | -------------------------------------------------------- |
| **Frontend dev server**     | `cd frontend && npm run dev`                             |
| **Backend deploy (dev)**    | `cd backend && npx cdk deploy --all --context stage=dev` |
| **Backend local emulation** | `cd backend && npm run sam:local`                        |
| **Run unit tests**          | `npm test` (root — runs both FE & BE tests)              |
| **Run integration tests**   | `npm run test:integration`                               |
| **Run E2E tests**           | `npm run test:e2e` (Playwright)                          |
| **Lint**                    | `npm run lint` (ESLint + Prettier, auto-fix)             |
| **Type check**              | `npm run typecheck` (tsc --noEmit)                       |
| **Seed dev data**           | `cd backend && npm run seed`                             |
| **Build frontend**          | `cd frontend && npm run build`                           |

---

## Code Style & Conventions

### General

- **Language**: TypeScript (strict mode) everywhere
- **Formatting**: Prettier (default config, 100 char line width)
- **Linting**: ESLint with `@typescript-eslint`, `eslint-plugin-react-hooks`
- **Naming**:
  - Files: `kebab-case.ts` / `PascalCase.tsx` (components)
  - Variables/functions: `camelCase`
  - Types/interfaces: `PascalCase`
  - Constants: `SCREAMING_SNAKE_CASE`
  - DynamoDB keys: `PK`, `SK`, `GSI1PK`, `GSI1SK`

### Frontend Patterns

- Feature-sliced architecture (co-locate components, hooks, types per feature)
- Server state via TanStack Query (no Redux for API data)
- Client state via Zustand (minimal — prefer URL state where possible)
- Lazy-load feature routes with `React.lazy` + `Suspense`
- Use `React.memo` and `useMemo` only when measured (avoid premature optimization)

### Backend Patterns

- Single-table DynamoDB design (access pattern-first modeling)
- Lambda handlers: thin controller → service layer → repository
- Shared types between FE/BE via `shared/types/` package
- All Lambda functions must be idempotent
- Use structured JSON logging (correlation IDs for tracing)
- Infrastructure as Code (CDK TypeScript)

### Example: API Response Format

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-06-22T10:00:00Z"
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "TRANSFER_DEADLINE_PASSED",
    "message": "The transfer window for Gameweek 3 has closed.",
    "details": {}
  },
  "meta": { ... }
}
```

---

## Git Workflow

- **Branching**: `main` (production), `develop` (integration), `feature/<ticket-id>-<short-desc>`, `fix/<ticket-id>-<short-desc>`
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`)
- **PRs**: Require 1 approval, all checks green (lint + typecheck + unit tests)
- **Deploy**: `develop` → auto-deploy to `dev` stage; `main` → deploy to `prod` via manual approval

---

## Boundaries

### ✅ Always Do

- Run `npm run lint` and `npm run typecheck` before committing
- Run unit tests for the changed module before pushing
- Use the shared type definitions from `shared/types/`
- Add scoring rule conformance tests for any new sport/scoring change
- Use environment variables (via Secrets Manager) for API keys
- Log all external API calls with correlation IDs
- Handle API rate limits gracefully (exponential backoff)
- Validate all user input server-side (never trust the client)

### ⚠️ Ask First

- Adding a new external dependency (npm package)
- Changing DynamoDB table schema or GSI definitions
- Modifying the CDK infrastructure stacks
- Altering the scoring engine algorithm
- Changing authentication flows or token handling
- Adding a new data provider integration

### 🚫 Never Do

- Commit API keys, secrets, or credentials to the repository
- Modify `node_modules/` or lock files manually
- Deploy directly to `prod` without going through `main` branch
- Store PII in DynamoDB without encryption
- Make synchronous calls to external APIs in hot request paths (use async/events)
- Skip the scoring conformance suite when modifying scoring logic
- Hard-code competition-specific logic in shared services (use the Competition config)

---

## Non-Functional Requirements

| Requirement                      | Target                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| **Latency (API p95)**            | < 200ms for reads, < 500ms for writes                             |
| **Throughput (game-day spikes)** | Handle 10,000 concurrent users per competition                    |
| **Data freshness**               | Scores updated within 5 minutes of real-world events              |
| **Availability**                 | 99.9% uptime (leveraging serverless auto-scaling)                 |
| **Cold start**                   | Lambda cold starts < 1s (use provisioned concurrency for scoring) |
| **Bundle size**                  | Frontend initial load < 200KB gzipped                             |
| **Lighthouse score**             | Performance > 90, Accessibility > 95                              |
| **Mobile responsive**            | Full functionality on screens ≥ 375px                             |

---

## Security

- All traffic over HTTPS (enforced at CloudFront + API Gateway)
- Cognito-issued JWTs validated on every API request
- API Gateway request throttling (per-user rate limits)
- Input validation with Zod schemas (shared FE/BE)
- DynamoDB encryption at rest (AWS-managed keys)
- WAF rules on CloudFront (SQL injection, XSS protection)
- Secrets rotated via AWS Secrets Manager
- CORS restricted to known origins

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

- [ ] Project scaffolding (monorepo, Vite, CDK)
- [ ] Authentication (Cognito + frontend auth flow)
- [ ] DynamoDB single-table design + GSIs + CDK stack
- [ ] Basic API Gateway + Lambda CRUD for users
- [ ] CI/CD pipeline (GitHub Actions → deploy to dev)

### Phase 2: Competition Engine (Week 3-4)

- [ ] Competition data model + CRUD
- [ ] Scoring rules engine (pluggable, config-driven)
- [ ] Data provider adapter (API-Football for World Cup)
- [ ] Initial roster sync job (Step Function)
- [ ] Player browse/search API

### Phase 3: Fantasy Core (Week 5-7)

- [ ] Squad builder (draft UI + validation logic)
- [ ] Transfer system (free transfers, wildcard chip)
- [ ] Gameweek deadline management
- [ ] Daily scoring pipeline (EventBridge → Step Function → Lambda)
- [ ] Scoring conformance test suite (all World Cup rules)

### Phase 4: Leagues & Social (Week 8-9)

- [ ] League creation/joining (private + public)
- [ ] Leaderboard (classic standings + H2H)
- [ ] League chat (basic real-time via WebSocket)
- [ ] Notifications (gameweek reminders, score updates)

### Phase 5: Live Experience (Week 10-11)

- [ ] WebSocket API for live score push
- [ ] Live match day dashboard (real-time point tickers)
- [ ] Player price change engine
- [ ] Auto-substitution logic

### Phase 6: Portability Proof (Week 12)

- [ ] Add second competition (Bundesliga 2025-26 or NBA 2025-26)
- [ ] Verify zero frontend code changes
- [ ] Document onboarding guide for new competitions
- [ ] Performance load testing (game-day simulation)

---

## World Cup 2026 Specifics

- **48 teams**, 12 groups of 4
- **Format**: Group stage (3 matches each) → Round of 32 → Round of 16 → QF → SF → Final
- **Hosts**: Canada, Mexico, United States (16 venues)
- **Tournament dates**: June 11 – July 19, 2026
- **Gameweeks**: Map to tournament rounds (GW1 = Group MD1, GW2 = Group MD2, ..., GW7 = Final)
- **Roster**: 26 players per national team
- **Special chips**: Wildcard (1 use), Triple Captain (1 use), Bench Boost (1 use), Free Hit (1 use)
- **Transfer windows**: 1 free transfer between each gameweek; additional transfers cost -4 points

---

## Open Questions / Decisions Needed

1. **Data provider contract**: API-Football vs. SportMonks — which has better World Cup coverage and rate limits?
2. **Head-to-head scoring**: Should H2H leagues use total weekly points or a separate H2H scoring matrix?
3. **Price change algorithm**: Net transfers in/out (FPL-style) or market-based (Yahoo-style)?
4. **Draft mode**: Should we support a snake draft (Yahoo-style) in addition to salary cap?
5. **Real-time vs. near-real-time**: WebSocket for all users or polling + push for critical events only?
6. **Monetization**: Free tier + premium (ad-free, advanced stats) or fully free?

---

## References

- [Addy Osmani — How to write a good spec for AI agents](https://addyosmani.com/blog/good-spec/)
- [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) — React/Next.js performance rules
- [frontend-design (Anthropic)](https://skills.sh/anthropics/skills/frontend-design) — Distinctive UI design skill
- [aws/agent-toolkit-for-aws](https://github.com/aws/agent-toolkit-for-aws) — Official AWS-supported MCP servers, skills, and plugins for AI coding agents (aws-core, aws-agents, aws-data-analytics)
- [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json) — Open data: World Cup 2026 fixtures, groups, results
- [FIFA World Cup 2026 — 48 teams, 12 groups](https://www.fifaworldcupnews.com/fifa-world-cup-2026-groups/)
- Yahoo Fantasy — Feature benchmark for full fantasy league capabilities
- FPL (Fantasy Premier League) — Scoring and transfer system reference
