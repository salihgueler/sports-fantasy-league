# Implementation Plan: Multi-Sport Fantasy League Engine

## Overview

This plan converts the design into incremental, code-focused tasks for a TypeScript monorepo: a React + Vite frontend and an AWS serverless backend provisioned with AWS CDK (TypeScript). Work is sequenced to match the design and `spec.md` phases — scaffolding, single-table data layer, Cognito auth, shared API middleware, then the domain services (Competition, Draft, Transfer, Gameweek, Scoring Engine, League, Realtime, Data Sync), then the scoring/sync orchestration, then the frontend, and finally the portability proof and performance/security hardening. Each task builds on prior tasks and ends with wiring so there is no orphaned code.

> **Testing policy (user standing rule):** Tests are written ONLY when the user explicitly asks. Every test sub-task below is marked optional with `*` and is gated: do not implement it unless the user requests tests. The platform's property-based tests use [`fast-check`](https://github.com/dubzzz/fast-check) with `numRuns >= 100`, each tagged `// Feature: multi-sport-fantasy-league, Property {number}: {property_text}`. The 33 correctness properties from the design map one-to-one onto the optional property-test sub-tasks here. The three headline properties — scoring determinism (Property 13), confirmed-score immutability (Property 12), and sync idempotence (Property 26) — are called out explicitly.

## Tasks

- [x] 1. Establish monorepo, shared types, and project scaffolding
  - [x] 1.1 Initialize the monorepo workspace and tooling
    - Create the workspace layout (`packages/shared`, `apps/web`, `infra/cdk`, `services/*`) with a package manager workspace config, TypeScript base config, ESLint/Prettier, and a root build script
    - Add a CI workflow stub (GitHub Actions) targeting a dev deploy as a placeholder for later wiring
    - _Requirements: 16.3, 19.4_

  - [x] 1.2 Define shared domain types and Zod schemas
    - In `packages/shared`, implement the core domain types from the design (`Competition`, `RosterConfig`, `TransferRules`, `Gameweek`, `ScoringRule`, `ScoringRuleset`, `SquadSlot`, `FantasyTeam`, `PlayerMatchStats`, `TeamGameweekScore`, `ChipType`, `ScoreStatus`, etc.)
    - Define Zod schemas for every API request body so the same schemas are shared between frontend and backend
    - _Requirements: 17.4, 18.9_

  - [x] 1.3 Scaffold the CDK app and the Vite React app
    - Create the CDK app entry (`infra/cdk`) with environment config and an empty root stack
    - Create the Vite + React + TypeScript app (`apps/web`) with React Router, TanStack Query, Zustand, and Tailwind configured
    - _Requirements: 16.3, 19.4_

- [x] 2. Provision the DynamoDB single-table data layer
  - [x] 2.1 Implement the DynamoDB single-table CDK stack
    - Define `FantasyTable` with on-demand capacity, `PK`/`SK` plus `GSI1` and `GSI2`, encryption at rest with an AWS-managed KMS key, point-in-time recovery, and a TTL attribute for ephemeral connection items
    - _Requirements: 18.5_

  - [x] 2.2 Implement the repository client and key builders
    - Implement a typed DynamoDB repository client in `packages/shared` with key/GSI builder helpers for every entity and access pattern in the design (competitions, players, fantasy teams, gameweek scores, leagues, memberships, H2H fixtures, chat, chip state, connections)
    - Implement conditional-write helpers used by the state-preservation invariant
    - _Requirements: 3.1, 3.4, 5.1, 10.7, 11.1, 12.2, 12.6, 13.1, 14.5, 15.8_

- [-] 3. Implement the shared API middleware layer
  - [x] 3.1 Implement the response envelope and request-id propagation
    - Build the `ApiSuccess`/`ApiError` envelope, `resolveRequestId` (reuse `x-request-id` or generate UUID v4), and UTC ISO-8601 `meta.timestamp`, plus structured logging with correlation ids
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 3.2 Implement the Zod validation middleware
    - Build `withValidation` that validates the request body before any processing; on failure return `VALIDATION_ERROR` with field-level detail, and `MALFORMED_REQUEST_BODY` for unparseable bodies; enforce max-length/format bounds
    - _Requirements: 17.4, 17.5, 17.6, 18.9_

  - [x] 3.3 Implement JWT context extraction and the error-handling layer
    - Extract authenticated user context from the validated Cognito JWT, and implement the central error classifier that maps error codes to HTTP status (400/401/403/404/409/429/500) through the envelope
    - _Requirements: 1.7, 18.2, 18.3_

  - [ ]\* 3.4 Write property test for the API response envelope and request-id propagation
    - **Property 29: API response envelope and request-id propagation**
    - **Validates: Requirements 17.1, 17.2, 17.3**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 3.5 Write property test for validation preceding state change
    - **Property 30: Validation precedes state change**
    - **Validates: Requirements 17.4, 17.5, 17.6, 18.9, 2.3, 2.5**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 3.6 Write property test for the JWT validation guard
    - **Property 31: JWT validation guard**
    - **Validates: Requirements 18.2, 18.3**
    - Gated: implement only if the user explicitly requests tests

- [x] 4. Implement Cognito authentication and the Auth/Profile service
  - [x] 4.1 Provision Cognito and the API Gateway JWT authorizer
    - Define the Cognito User Pool (email + optional social IdP) with the password policy, 5-failures/15-min lockout, access-token 60-min and refresh-token 30-day lifetimes, and email verification; wire the API Gateway REST API with a JWT authorizer and per-user throttling
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.9, 1.10, 18.2, 18.4_

  - [x] 4.2 Implement the Auth Service
    - Implement `register`, `signIn`, and `refresh` wrapping Cognito and mapping results/errors to the platform envelope (`EMAIL_ALREADY_REGISTERED`, `INVALID_CREDENTIALS`, verification-required, lockout)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8, 1.9, 1.10_

  - [x] 4.3 Implement the Profile Service
    - Implement `getProfile`, `updateDisplayName` (1–50 chars, `INVALID_DISPLAY_NAME`), `updateNotificationPrefs` (enumerated channels/types, `INVALID_NOTIFICATION_PREFERENCE`), and `createAvatarUploadUrl` (S3 pre-signed URL constrained to JPEG/PNG ≤ 5 MB)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 6. Implement the Competition Service
  - [x] 6.1 Implement competition repository reads
    - Implement `list` (default `upcoming`/`active` by start asc, `completed` filter by end desc, ≤100) and `getById` (`COMPETITION_NOT_FOUND`) over GSI1/GSI2
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 Implement competition creation with referential integrity
    - Implement `create` validating that referenced `ScoringRuleset`, `DataProviderAdapter`, and `RosterConfig` exist and all required fields are present; persist with status `draft`, reporting each missing/invalid field on failure without persisting
    - _Requirements: 16.1, 16.2, 16.7_

  - [ ]\* 6.3 Write property test for competition configuration validation
    - **Property 27: Competition configuration validation**
    - **Validates: Requirements 16.1, 16.2**
    - Gated: implement only if the user explicitly requests tests

- [-] 7. Implement the Draft Service
  - [x] 7.1 Implement the player pool query
    - Implement `getPlayerPool` with filtering by real-world team, position, price, total points, and availability via GSI1/GSI2; return an empty list (not an error) when nothing matches
    - _Requirements: 5.1, 5.2_

  - [x] 7.2 Implement squad validation and submission
    - Implement the pure squad validator over `RosterConfig` (squad size, per-position min/max, per-team cap, distinct players, competition membership, budget) and `submitSquad` returning non-negative remaining budget; map each failure to its error code and leave any prior team unchanged
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]\* 7.3 Write property test for squad submission validity
    - **Property 1: Squad submission accepts exactly the valid squads**
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**
    - Gated: implement only if the user explicitly requests tests

  - [x] 7.4 Implement auto-pick
    - Implement `autoPick` to fill empty slots with distinct competition players satisfying position counts, per-team cap, and remaining budget, or leave the squad unchanged and return `AUTO_PICK_INFEASIBLE`
    - _Requirements: 5.9, 5.10_

  - [ ]\* 7.5 Write property test for auto-pick
    - **Property 2: Auto-pick output always satisfies constraints or signals infeasible**
    - **Validates: Requirements 5.9, 5.10**
    - Gated: implement only if the user explicitly requests tests

  - [x] 7.6 Implement captaincy designation
    - Implement `setCaptaincy` persisting distinct captain/vice-captain who are squad members; reject with `INVALID_CAPTAIN_SELECTION` otherwise
    - _Requirements: 5.11, 5.12_

  - [x] 7.7 Implement formation validation
    - Implement the pure formation validator and `setFormation` (starting count = `startingXI`, per-position min/max, members-of-squad), rejecting with `INVALID_FORMATION` or a not-in-squad error without persisting
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]\* 7.8 Write property test for formation validity
    - **Property 3: Formation validity**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Gated: implement only if the user explicitly requests tests

- [-] 8. Implement the Transfer Service
  - [x] 8.1 Implement transfer submission with penalties and guards
    - Implement `submitTransfer`: replace outgoing with incoming, decrement free transfers, timestamp the transfer; apply zero penalty while free transfers remain and `penaltyPointsPerExtra` (default 4) beyond; skip penalty/decrement while Wildcard or Free Hit is active; reject with `TRANSFER_DEADLINE_PASSED`, `BUDGET_EXCEEDED`, `PLAYER_ALREADY_IN_SQUAD` leaving the squad unchanged
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 8.2 Implement gameweek free-transfer granting and carry-over
    - Implement `grantGameweekTransfers` granting `min(freeTransfersPerGameweek + unusedCarriedOver, carryOverLimit)` (default carry cap 2)
    - _Requirements: 7.7_

  - [ ]\* 8.3 Write property test for free-transfer carry-over
    - **Property 4: Free-transfer carry-over never exceeds the cap**
    - **Validates: Requirements 7.7**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 8.4 Write property test for transfer penalties
    - **Property 5: Transfer penalties apply exactly beyond the free allowance**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.8, 8.2**
    - Gated: implement only if the user explicitly requests tests

- [-] 9. Implement the Gameweek Service
  - [x] 9.1 Implement the deadline guard and gameweek state
    - Implement `assertBeforeDeadline` using the server-side UTC clock as the sole authoritative time source, applied to every squad/transfer/captain/chip mutation; implement `getGameweekState` returning the UTC `transferDeadline`
    - _Requirements: 8a.1, 8a.2, 8a.3, 8a.4_

  - [ ]\* 9.2 Write property test for deadline enforcement
    - **Property 8: Deadline enforcement using the server UTC clock**
    - **Validates: Requirements 8a.1, 8a.2, 8a.4**
    - Gated: implement only if the user explicitly requests tests

  - [x] 9.3 Implement chip activation
    - Implement `activateChip` recording a chip active and decrementing uses only when configured for the competition, with remaining uses, no other chip active, and before the deadline; otherwise reject with `CHIP_NOT_CONFIGURED`, `CHIP_UNAVAILABLE`, `CHIP_ALREADY_ACTIVE`, or `TRANSFER_DEADLINE_PASSED` leaving chip state unchanged
    - _Requirements: 8.1, 8.6, 8.7, 8.8, 8.9_

  - [ ]\* 9.4 Write property test for the chip activation guard
    - **Property 6: Chip activation guard**
    - **Validates: Requirements 8.1, 8.6, 8.7, 8.8, 8.9**
    - Gated: implement only if the user explicitly requests tests

  - [x] 9.5 Implement Free Hit squad restoration
    - Apply Free Hit squad changes to the current gameweek only and restore the prior squad at the start of the next gameweek
    - _Requirements: 8.5_

  - [ ]\* 9.6 Write property test for Free Hit restoration
    - **Property 7: Free Hit restores the prior squad**
    - **Validates: Requirements 8.5**
    - Gated: implement only if the user explicitly requests tests

  - [x] 9.7 Implement auto-substitution during finalization
    - Implement `finalizeGameweek` auto-substitution: replace 0-minute starters in ascending lineup order with the highest-priority bench player with ≥1 minute preserving position constraints, completing one substitution before the next; transfer the captain multiplier to the vice when the captain played 0 and the vice ≥1, and apply no multiplier when both played 0
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]\* 9.8 Write property test for auto-substitution
    - **Property 9: Auto-substitution preserves position constraints**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
    - Gated: implement only if the user explicitly requests tests

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 11. Implement the Scoring Engine
  - [x] 11.1 Implement the pure player-points computation
    - Implement `computePlayerPoints` applying the competition `ScoringRuleset` (per-every-N rules, minutes-played thresholds, signed deductions), allowing negative net totals, and returning a signed per-statistic breakdown that sums to the total
    - _Requirements: 10.1, 10.8_

  - [ ]\* 11.2 Write property test for scoring correctness and signed breakdown
    - **Property 10: Scoring correctness and signed breakdown**
    - **Validates: Requirements 10.1, 10.8**
    - Gated: implement only if the user explicitly requests tests

  - [x] 11.3 Implement team gameweek score aggregation with chips
    - Implement `computeTeamGameweekScore` summing starters with the captain multiplied by the configured multiplier (default 2), ×3 for Triple Captain, and including all bench players for Bench Boost
    - _Requirements: 10.2, 10.3, 10.4, 8.3, 8.4_

  - [ ]\* 11.4 Write property test for team gameweek score aggregation
    - **Property 11: Team gameweek score aggregation**
    - **Validates: Requirements 10.2, 10.3, 10.4, 8.3, 8.4**
    - Gated: implement only if the user explicitly requests tests

  - [x] 11.5 Implement the provisional/confirmed score lifecycle persistence
    - Persist gameweek scores with `scoreStatus`; mark `PROVISIONAL` in the live window and `CONFIRMED` after reconciliation; reject recomputation of a `CONFIRMED` score via a conditional write and return a finalized indication
    - _Requirements: 10.5, 10.6, 10.7_

  - [ ]\* 11.6 Write property test for confirmed-score immutability (headline)
    - **Property 12: Confirmed-score immutability**
    - **Validates: Requirements 10.7**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 11.7 Write property test for scoring determinism (headline)
    - **Property 13: Scoring determinism**
    - **Validates: Requirements 10.9**
    - Gated: implement only if the user explicitly requests tests

- [-] 12. Implement the League Service
  - [x] 12.1 Implement league creation with join codes
    - Implement `createLeague` generating an 8-character alphanumeric join code unique across active leagues, with max member count 2–100
    - _Requirements: 12.1_

  - [ ]\* 12.2 Write property test for join code format and uniqueness
    - **Property 16: Join code format and uniqueness**
    - **Validates: Requirements 12.1**
    - Gated: implement only if the user explicitly requests tests

  - [x] 12.3 Implement league joining with guards
    - Implement `joinByCode` and `joinPublic` adding the user's fantasy team only when the target exists, the league is below max, the user has a team for the competition, and is not already a member; otherwise reject with `INVALID_JOIN_CODE`, `LEAGUE_FULL`, `NO_FANTASY_TEAM`, or `ALREADY_MEMBER`
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ]\* 12.4 Write property test for the league join guard
    - **Property 17: League join guard**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.7**
    - Gated: implement only if the user explicitly requests tests

  - [x] 12.5 Implement standings (classic and head-to-head)
    - Implement `getStandings`: classic (descending cumulative total, tie-break by most recent completed gameweek score, shared ranks) and H2H (3/1/0 results, descending cumulative H2H points, tie-break by cumulative total, shared ranks); return a single-entry list for leagues with fewer than 2 members
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6, 13.7_

  - [ ]\* 12.6 Write property test for standings ranking and tie-breaks
    - **Property 18: Standings ranking and tie-breaks**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
    - Gated: implement only if the user explicitly requests tests

  - [x] 12.7 Implement the round-robin H2H schedule
    - Implement `generateH2HSchedule` producing a single round-robin where every member meets every other exactly once before any repeat
    - _Requirements: 13.5_

  - [ ]\* 12.8 Write property test for the round-robin schedule
    - **Property 19: Round-robin schedule covers every pairing exactly once**
    - **Validates: Requirements 13.5**
    - Gated: implement only if the user explicitly requests tests

  - [x] 12.9 Implement league chat posting and history
    - Implement `postMessage` (trimmed 1–500 chars, membership check, server timestamp, deliver via Realtime Service in ascending order; reject with `MESSAGE_TOO_LONG`, `EMPTY_MESSAGE`, `NOT_A_LEAGUE_MEMBER`) and `getChatHistory` (descending, pages of ≤50 with a pagination token)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ]\* 12.10 Write property test for chat message validation and ordering
    - **Property 20: Chat message validation and ordering**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 12.11 Write property test for chat history pagination
    - **Property 21: Chat history pagination is complete and non-overlapping**
    - **Validates: Requirements 14.5**
    - Gated: implement only if the user explicitly requests tests

- [-] 13. Implement the Realtime Service
  - [x] 13.1 Provision the WebSocket API and connect authorizer
    - Define the API Gateway WebSocket API in CDK with a `$connect` Lambda authorizer that rejects missing/expired/invalid-signature JWTs before registration and stores connection items (with TTL)
    - _Requirements: 11.2, 11.3_

  - [x] 13.2 Implement subscription management and reconnect
    - Implement `subscribe` enforcing a per-connection cap of 50 (rejecting excess with a subscription-limit indication) and `onReconnect` restoring prior subscriptions
    - _Requirements: 11.5, 11.6_

  - [ ]\* 13.3 Write property test for live-update fan-out
    - **Property 14: Live update fan-out targets exactly the subscribers**
    - **Validates: Requirements 11.1**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 13.4 Write property test for the subscription cap
    - **Property 15: Subscription cap**
    - **Validates: Requirements 11.6**
    - Gated: implement only if the user explicitly requests tests

  - [x] 13.5 Implement score and chat fan-out
    - Implement `fanOut` querying subscriptions by competition (GSI) and pushing `ScoreUpdated`/`ChatMessage` only to subscribed connections
    - _Requirements: 11.1, 11.4, 14.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 15. Implement the Data Provider Adapter and Data Sync Service
  - [x] 15.1 Implement the adapter interface, registry, and canonical statistic map
    - Define `DataProviderAdapter`, an adapter registry resolved by `dataProviderId`, the `Canonical_Statistic_Map`, and `mapToCanonicalStats` that applies only mapped keys and rejects unmapped keys with an error, never applying them to scoring
    - _Requirements: 16.4, 16.5, 16.6_

  - [ ]\* 15.2 Write property test for canonical statistic mapping
    - **Property 28: Canonical statistic mapping rejects unmapped keys**
    - **Validates: Requirements 16.5, 16.6**
    - Gated: implement only if the user explicitly requests tests

  - [x] 15.3 Implement the World Cup 2026 data provider adapter
    - Implement an adapter (API-Football / openfootball) mapping rosters, fixtures, and live scores to the canonical model and stat keys; retrieve credentials from Secrets Manager at runtime
    - _Requirements: 16.4, 16.5, 18.7_

  - [x] 15.4 Implement the exponential backoff calculator
    - Implement a pure backoff helper waiting `min(1s × 2^n, 60s)` before attempt n and stopping after at most 5 attempts
    - _Requirements: 15.5_

  - [ ]\* 15.5 Write property test for the exponential backoff schedule
    - **Property 23: Exponential backoff schedule**
    - **Validates: Requirements 15.5**
    - Gated: implement only if the user explicitly requests tests

  - [x] 15.6 Implement idempotent roster sync with reconciliation and quarantine
    - Implement `syncRoster`: update existing players, add new players, mark absent players unavailable; quarantine individual missing-field records (retaining their state); abort all-or-nothing on outage/timeout after exhausted retries with a recorded failure indication; use deterministic keys + content-based conditional upserts for idempotence
    - _Requirements: 15.1, 15.6, 15.7, 15.8_

  - [ ]\* 15.7 Write property test for roster sync reconciliation
    - **Property 22: Roster sync reconciliation**
    - **Validates: Requirements 15.1**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 15.8 Write property test for individual missing-field rejection
    - **Property 25: Missing-field records are rejected individually**
    - **Validates: Requirements 15.7**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 15.9 Write property test for all-or-nothing sync on failure
    - **Property 24: Sync is all-or-nothing on failure**
    - **Validates: Requirements 15.6**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 15.10 Write property test for sync idempotence (headline)
    - **Property 26: Sync idempotence**
    - **Validates: Requirements 15.8**
    - Gated: implement only if the user explicitly requests tests

  - [x] 15.11 Implement fixture, price, and live-score sync
    - Implement `syncFixtures` (kickoff/venue/status), `syncPrices` (recompute price from transfer activity, append to price history), and `syncLiveScores` (fetch stats, publish `ScoreUpdated` to the event bus)
    - _Requirements: 15.2, 15.3, 15.4_

- [x] 16. Implement scoring/sync orchestration
  - [x] 16.1 Implement the Scoring Step Functions state machine
    - Define the scoring state machine wiring the adapter fetch → pure scoring Lambda → DynamoDB upsert (provisional in live window, confirmed in reconciliation) → emit `ScoreUpdated`
    - _Requirements: 10.5, 10.6, 11.4, 19.5_

  - [x] 16.2 Implement the Data Sync Step Functions state machine
    - Define the sync state machine orchestrating roster/fixture/price/live-score sync with backoff and all-or-nothing semantics, invoking the competition's adapter
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 16.4_

  - [x] 16.3 Wire EventBridge scheduling and ScoreUpdated routing
    - Configure EventBridge Scheduler (live every 5 min / reconcile daily) to trigger the state machines and route `ScoreUpdated` from the bus to the Realtime fan-out Lambda
    - _Requirements: 11.1, 11.4, 19.5_

  - [x] 16.4 Wire the SQS spike buffer and DLQ
    - Add SQS buffering of scoring/sync workloads consumed at controlled concurrency during spikes, with a dead-letter queue and alarmed DLQ depth
    - _Requirements: 19.3_

- [x] 17. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implement frontend foundation, theming, and API/auth client
  - [x] 18.1 Implement routing and the auth flow
    - Implement React Router routes, sign-up/sign-in/verify screens against the Auth Service, and access/refresh token handling with automatic refresh
    - _Requirements: 1.1, 1.3, 1.5, 1.9_

  - [x] 18.2 Implement the API client and envelope handling
    - Implement a typed API client over TanStack Query that sends `x-request-id`, parses the success/error envelope, and surfaces field-level validation errors
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 18.3 Implement the config-driven theming layer
    - Apply competition theme tokens as CSS custom properties via a `data-competition` attribute, switching within 100 ms on competition change, falling back to the default World Cup 2026 theme, preserving accent colors in dark mode, and authoring tokens to meet WCAG contrast ratios (4.5:1 normal / 3:1 large + interactive)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 18.4 Implement competition discovery and detail views
    - Implement the competition list and detail pages rendering purely from persisted competition configuration (roster config, transfer rules, schedule, scoring breakdown) with no hardcoded competition logic
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 16.3_

- [x] 19. Implement the frontend draft room and team management
  - [x] 19.1 Implement the player pool browser and draft room
    - Implement the player pool view with filters (team, position, price, points, availability) and the draft room layout rendered from `RosterConfig`
    - _Requirements: 5.1, 5.2_

  - [x] 19.2 Implement squad builder, auto-pick, captaincy, and formation UI
    - Implement squad selection with live budget/position/cap feedback, auto-pick, captain/vice designation, and formation editing wired to the Draft Service
    - _Requirements: 5.3, 5.9, 5.11, 6.1, 6.2_

  - [x] 19.3 Implement transfers and chips UI
    - Implement the transfer screen (free-transfer count, penalty preview, deadline state) and chip activation controls wired to the Transfer and Gameweek services
    - _Requirements: 7.1, 7.3, 8.1, 8a.3_

- [x] 20. Implement the frontend leagues and leaderboard
  - [x] 20.1 Implement league creation and joining
    - Implement create-league (private/public, max members, join code display) and join-by-code/public-join flows wired to the League Service
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 20.2 Implement standings views
    - Implement classic and head-to-head standings tables showing member identifier, ranking points, and assigned rank
    - _Requirements: 13.1, 13.2, 13.6_

  - [x] 20.3 Implement the league chat UI
    - Implement the chat panel with message send, validation feedback, paginated history (≤50), and live delivery via the WebSocket client
    - _Requirements: 14.1, 14.5_

- [x] 21. Implement the frontend live experience
  - [x] 21.1 Implement the WebSocket client
    - Implement the WSS client connecting with the JWT, subscribing to competitions (≤50), and restoring subscriptions on reconnect
    - _Requirements: 11.2, 11.5, 11.6_

  - [x] 21.2 Implement the live match-day dashboard
    - Implement real-time point tickers that update from `ScoreUpdated` pushes for subscribed competitions
    - _Requirements: 11.1, 11.4_

- [x] 22. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 23. Implement security hardening
  - [x] 23.1 Configure CloudFront, WAF, and TLS
    - Configure CloudFront with HTTP→HTTPS redirect over TLS 1.2+, a WAF web ACL blocking SQLi/XSS patterns before backend forwarding
    - _Requirements: 18.1, 18.8_

  - [x] 23.2 Configure API Gateway rate limiting and CORS
    - Implement per-user rate limiting (reject >100 requests / 60-second rolling window with `RATE_LIMIT_EXCEEDED`) and CORS restricted to the allowed-origins list
    - _Requirements: 18.4, 18.6_

  - [ ]\* 23.3 Write property test for the rate-limit window
    - **Property 32: Rate-limit window**
    - **Validates: Requirements 18.4**
    - Gated: implement only if the user explicitly requests tests

  - [ ]\* 23.4 Write property test for the CORS allow-list
    - **Property 33: CORS allow-list**
    - **Validates: Requirements 18.6**
    - Gated: implement only if the user explicitly requests tests

  - [x] 23.5 Configure secrets rotation and verify encryption at rest
    - Configure Secrets Manager rotation at ≤ 90-day intervals for provider credentials and assert DynamoDB encryption at rest in the CDK stack
    - _Requirements: 18.5, 18.7_

- [x] 24. Prove portability with a second competition
  - [x] 24.1 Onboard a second competition by configuration only
    - Add a second competition (Bundesliga 2025-26 or NBA 2025-26): create/reuse its `ScoringRuleset`, register its `DataProviderAdapter` binding, and submit the `Competition` config with theme tokens — no scoring/service/frontend code changes
    - _Requirements: 16.1, 16.3, 16.4, 16.7_

  - [x] 24.2 Seed and validate zero frontend code changes
    - Run the idempotent initial roster/fixture sync through the new adapter and verify the Web Client renders the new competition from configuration alone (no redeploy of frontend logic)
    - _Requirements: 16.3, 15.8_

- [x] 25. Implement performance hardening
  - [x] 25.1 Tune backend for game-day scale
    - Configure provisioned concurrency for the scoring Lambdas, on-demand DynamoDB, and read-path caching to hold p95 read ≤ 200 ms and write ≤ 500 ms at 10k concurrent users per competition
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 25.2 Tune frontend bundle and performance budgets
    - Apply code splitting and lazy loading to keep initial JS ≤ 200 KB gzipped and configure a Lighthouse CI gate (Performance ≥ 90) and a bundle-size budget check
    - _Requirements: 19.4, 19.7_

- [x] 26. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks. Per the user's standing rule, they are NOT implemented unless the user explicitly asks for tests. Each maps to exactly one correctness property from the design.
- The three headline properties are scoring determinism (Property 13, task 11.7), confirmed-score immutability (Property 12, task 11.6), and sync idempotence (Property 26, task 15.10).
- Every implementation task references specific sub-requirements for traceability.
- Checkpoints (tasks 5, 10, 14, 17, 22, 26) provide incremental validation points.
- Frontend is React + Vite + TypeScript; backend is AWS serverless via AWS CDK (TypeScript). No agent/LLM component is currently warranted; if one is later introduced it must use Strands Agents with Claude Haiku 4.5 on Amazon Bedrock.
- The state-preservation invariant (a rejected mutation never alters persisted state) is enforced via validate-before-write and DynamoDB conditional expressions throughout the mutating services.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6", "4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1", "7.2"] },
    { "id": 7, "tasks": ["6.3", "7.3", "7.4", "7.6", "7.7"] },
    { "id": 8, "tasks": ["7.5", "7.8", "8.1", "8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "9.1", "9.3", "9.5", "9.7"] },
    { "id": 10, "tasks": ["9.2", "9.4", "9.6", "9.8", "11.1", "11.3"] },
    {
      "id": 11,
      "tasks": ["11.2", "11.4", "11.5", "12.1", "12.3", "12.5", "12.7", "12.9"]
    },
    {
      "id": 12,
      "tasks": [
        "11.6",
        "11.7",
        "12.2",
        "12.4",
        "12.6",
        "12.8",
        "12.10",
        "12.11",
        "13.1"
      ]
    },
    { "id": 13, "tasks": ["13.2", "13.5", "15.1", "15.3", "15.4"] },
    { "id": 14, "tasks": ["13.3", "13.4", "15.2", "15.5", "15.6", "15.11"] },
    { "id": 15, "tasks": ["15.7", "15.8", "15.9", "15.10", "16.1", "16.2"] },
    { "id": 16, "tasks": ["16.3", "16.4", "18.1", "18.2", "18.3"] },
    { "id": 17, "tasks": ["18.4", "19.1", "20.1", "21.1"] },
    { "id": 18, "tasks": ["19.2", "19.3", "20.2", "20.3", "21.2"] },
    { "id": 19, "tasks": ["23.1", "23.2", "23.5"] },
    { "id": 20, "tasks": ["23.3", "23.4", "24.1"] },
    { "id": 21, "tasks": ["24.2", "25.1", "25.2"] }
  ]
}
```
