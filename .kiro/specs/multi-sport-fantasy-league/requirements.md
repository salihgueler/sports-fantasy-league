# Requirements Document

## Introduction

This document specifies the requirements for the Multi-Sport Fantasy League Engine, a production-ready and extensible fantasy sports platform. The platform launches with FIFA World Cup 2026 and is architected so that adding a new competition (for example Bundesliga, Premier League, NBA, or Euroleague) is a configuration change rather than a code rewrite.

The system lets users register, draft fantasy squads, manage transfers, compete in leagues, and track leaderboards across any supported competition. Scoring is driven by real player performance ingested from external data providers and applied through a pluggable, configuration-driven scoring ruleset. A core design goal is portability: the frontend renders dynamically from each competition's configuration, so onboarding a new competition requires no frontend code changes.

The backend runs on AWS serverless infrastructure (Lambda, API Gateway REST and WebSocket, DynamoDB single-table design, EventBridge, Step Functions, SQS, S3, CloudFront, Cognito, Secrets Manager). The frontend is a React and Vite TypeScript application.

## Glossary

- **Platform**: The complete Multi-Sport Fantasy League Engine, including frontend and backend.
- **Auth_Service**: The backend service responsible for registration, authentication, session management, and user profiles, backed by Amazon Cognito.
- **Competition_Service**: The backend service that manages competition configuration records and exposes competition data to clients.
- **Draft_Service**: The backend service that validates and persists fantasy squad selections.
- **Transfer_Service**: The backend service that processes player transfers, free transfer allowances, and transfer point penalties.
- **Gameweek_Service**: The backend service that manages gameweek deadlines, auto-substitution, and chip activation.
- **Scoring_Engine**: The backend orchestration (AWS Step Functions and Lambda) that converts player match statistics into fantasy points using a Scoring_Ruleset.
- **League_Service**: The backend service that manages league creation, membership, standings, and chat.
- **Data_Sync_Service**: The backend background workflows that synchronize rosters, fixtures, live scores, and player prices from external data providers.
- **Data_Provider_Adapter**: A pluggable interface implementation that maps an external data source to the Platform's canonical data model.
- **Realtime_Service**: The backend WebSocket service (API Gateway WebSocket) that pushes live updates to connected clients.
- **Web_Client**: The React and Vite frontend application.
- **Competition**: A configuration record describing a sport, format, roster rules, transfer rules, schedule, scoring ruleset, and data provider for one tournament or season.
- **Scoring_Ruleset**: A configuration record mapping player statistics to fantasy point values for a sport or competition.
- **Roster_Config**: The portion of a Competition that defines positions, squad size, starting lineup size, budget, and captain multiplier.
- **Fantasy_Team**: A user's squad of players within a single league and competition.
- **League**: A grouping of fantasy teams that compete against one another, either classic (total points) or head-to-head.
- **Gameweek**: A scoring period within a competition, mapped to a tournament round or matchday.
- **Chip**: A single-use gameweek modifier (Wildcard, Triple Captain, Bench Boost, or Free Hit).
- **Transfer_Deadline**: The server-enforced timestamp after which squad and transfer changes for a gameweek are locked.
- **Provisional_Score**: A gameweek score computed during or shortly after live events, subject to later revision.
- **Confirmed_Score**: A finalized gameweek score that the Platform treats as immutable.
- **JWT**: A JSON Web Token issued by Amazon Cognito used to authenticate API requests.
- **Notification_Channel**: A delivery mechanism for notifications, one of email or push.
- **Notification_Type**: A category of notification, one of game reminders, score updates, league invitations, or trade offers.
- **Per_Team_Cap**: The maximum number of players from a single real-world team that a Fantasy_Team may include, defined in the Roster_Config.
- **Canonical_Statistic_Map**: The Platform's authoritative mapping of statistic keys used to normalize external data provider statistics for scoring.

## Requirements

### Requirement 1: User Registration and Authentication

**User Story:** As a sports fan, I want to create an account and sign in, so that I can manage my fantasy teams and leagues securely.

#### Acceptance Criteria

1. WHEN a visitor submits a registration request with a valid email address and a password that meets the password policy (8 to 128 characters, containing at least one uppercase letter, one lowercase letter, one number, and one special character), THE Auth_Service SHALL create a user account in an unverified state and send a verification email to the submitted address.
2. WHEN a visitor submits a registration request with an email address that already has an account, THE Auth_Service SHALL reject the request and return an error with code `EMAIL_ALREADY_REGISTERED`, without creating a new account.
3. WHEN a registered user with a verified account submits valid credentials, THE Auth_Service SHALL issue a JWT access token that expires 60 minutes after issuance and a refresh token that expires 30 days after issuance.
4. IF a sign-in request contains credentials that do not match an active account, THEN THE Auth_Service SHALL reject the request and return an error with code `INVALID_CREDENTIALS`.
5. WHEN a user submits a valid, non-expired refresh token, THE Auth_Service SHALL issue a new JWT access token that expires 60 minutes after issuance.
6. WHERE social sign-in is configured for an identity provider, THE Auth_Service SHALL authenticate the user through that identity provider and issue a JWT access token that expires 60 minutes after issuance.
7. IF an API request includes an expired or invalid JWT, THEN THE Platform SHALL reject the request and return an error with code `UNAUTHORIZED`.
8. IF a registration request contains an email address that does not conform to a valid email format, or a password that does not meet the password policy, THEN THE Auth_Service SHALL reject the request and return an error indicating the specific validation failure, without creating an account.
9. IF a user whose account is in an unverified state submits valid credentials, THEN THE Auth_Service SHALL reject the sign-in request and return an error indicating that email verification is required, without issuing any token.
10. IF a user submits invalid credentials 5 consecutive times within a 15-minute window, THEN THE Auth_Service SHALL lock the account for 15 minutes and return an error indicating the account is temporarily locked.

### Requirement 2: User Profile Management

**User Story:** As a registered user, I want to manage my profile and notification preferences, so that I can personalize my experience.

#### Acceptance Criteria

1. WHEN an authenticated user requests their profile, THE Auth_Service SHALL return the display name, avatar reference, and notification preferences for that user within 2 seconds.
2. WHEN an authenticated user submits an updated display name of 1 to 50 characters, THE Auth_Service SHALL persist the updated display name.
3. IF an authenticated user submits a display name shorter than 1 character or longer than 50 characters, THEN THE Auth_Service SHALL reject the update, retain the previously stored display name, and return an error with code `INVALID_DISPLAY_NAME`.
4. WHEN an authenticated user updates one or more notification preferences, where each preference enables or disables a notification channel (email, push) for a notification type (game reminders, score updates, league invitations, trade offers), THE Auth_Service SHALL persist the updated preferences and apply them to subsequent notifications.
5. IF an authenticated user submits a notification preference that references a channel or type outside the enumerated set (channels: email, push; types: game reminders, score updates, league invitations, trade offers), THEN THE Auth_Service SHALL reject the update, retain the previously stored preferences, and return an error with code `INVALID_NOTIFICATION_PREFERENCE`.
6. WHEN an authenticated user uploads an avatar image in JPEG or PNG format not exceeding 5 MB, THE Auth_Service SHALL store the image and update the user's avatar reference.
7. IF an authenticated user uploads an avatar image that is not in JPEG or PNG format, or that exceeds 5 MB, THEN THE Auth_Service SHALL reject the upload, retain the previously stored avatar reference, and return an error indicating the avatar format or size constraint that was violated.

### Requirement 3: Competition Discovery and Detail

**User Story:** As a user, I want to browse available competitions and view their rules, so that I can choose which competition to play.

#### Acceptance Criteria

1. WHEN a user requests the competition list without specifying a status filter, THE Competition_Service SHALL return all competitions with status `upcoming` or `active`, ordered by scheduled start time in ascending order (earliest start first), returning at most 100 competitions per request.
2. WHEN a user requests a competition detail by its unique identifier, THE Competition_Service SHALL return that competition's roster configuration, transfer rules, schedule, and scoring breakdown.
3. WHERE a competition has status `completed`, THE Competition_Service SHALL exclude that competition from the default competition list.
4. WHERE a user requests the competition list with a status filter of `completed`, THE Competition_Service SHALL return all competitions with status `completed`, ordered by scheduled end time in descending order (most recently ended first), returning at most 100 competitions per request.
5. IF a user requests a competition that does not exist, THEN THE Competition_Service SHALL return an error with code `COMPETITION_NOT_FOUND`, and SHALL NOT return any competition data.

### Requirement 4: Configuration-Driven Competition Theming

**User Story:** As a user, I want each competition to display its own visual theme, so that the experience reflects the competition I am playing.

#### Acceptance Criteria

1. WHEN the Web_Client renders a competition view, THE Web_Client SHALL apply the theme associated with the active competition identifier within 100 milliseconds of the view becoming visible.
2. THE Web_Client SHALL reference all competition colors through CSS custom properties rather than literal color values in components.
3. IF no competition-specific theme is defined for the active competition identifier, THEN THE Web_Client SHALL apply the default World Cup 2026 theme.
4. WHILE dark mode is enabled, THE Web_Client SHALL apply dark surface and background colors while preserving the competition accent colors.
5. WHEN the active competition identifier changes, THE Web_Client SHALL update the displayed theme to match the new competition within 100 milliseconds.
6. THE Web_Client SHALL maintain a minimum text-to-background contrast ratio of at least 4.5:1 for normal text and at least 3:1 for large text and interactive element boundaries across all competition themes in both light and dark modes.

### Requirement 5: Squad Drafting and Budget Enforcement

**User Story:** As a user, I want to draft a squad within a budget and position constraints, so that I can field a valid fantasy team.

#### Acceptance Criteria

1. WHEN a user requests the player pool for a competition, THE Draft_Service SHALL return, within 3 seconds, the list of players associated with that competition, each filterable by real-world team, position, price, total points, and availability.
2. WHEN a user requests the player pool and no players match the applied filters, THE Draft_Service SHALL return an empty list rather than an error.
3. WHEN a user submits a squad selection that satisfies the competition Roster_Config, contains only distinct players belonging to the requested competition, respects the per-real-world-team cap defined in the Roster_Config, and whose total price does not exceed the competition budget, THE Draft_Service SHALL persist the Fantasy_Team and return the remaining budget as a non-negative value.
4. IF a user submits a squad selection whose total price exceeds the competition budget, THEN THE Draft_Service SHALL reject the selection, leave any previously persisted Fantasy_Team unchanged, and return an error with code `BUDGET_EXCEEDED`.
5. IF a user submits a squad selection that violates a position count defined in the Roster_Config, THEN THE Draft_Service SHALL reject the selection, leave any previously persisted Fantasy_Team unchanged, and return an error with code `INVALID_POSITION_COUNT`.
6. IF a user submits a squad selection whose player count does not equal the Roster_Config squad size, THEN THE Draft_Service SHALL reject the selection, leave any previously persisted Fantasy_Team unchanged, and return an error with code `INVALID_SQUAD_SIZE`.
7. IF a user submits a squad selection that contains the same player more than once, THEN THE Draft_Service SHALL reject the selection, leave any previously persisted Fantasy_Team unchanged, and return an error with code `DUPLICATE_PLAYER`.
8. IF a user submits a squad selection that contains a player not belonging to the requested competition or that exceeds the per-real-world-team cap defined in the Roster_Config, THEN THE Draft_Service SHALL reject the selection, leave any previously persisted Fantasy_Team unchanged, and return an error with code `INVALID_PLAYER_SELECTION`.
9. WHEN a user requests auto-pick for remaining empty squad slots, THE Draft_Service SHALL fill the empty slots with distinct players from the requested competition that satisfy the Roster_Config position counts, the per-real-world-team cap, and the remaining budget.
10. IF a user requests auto-pick and no combination of eligible players can fill the empty slots within the remaining budget and Roster_Config constraints, THEN THE Draft_Service SHALL leave the squad unchanged and return an error with code `AUTO_PICK_INFEASIBLE`.
11. WHEN a user designates one squad player as captain and one different squad player as vice-captain, THE Draft_Service SHALL persist the captain and vice-captain designations.
12. IF a user designates the same player as both captain and vice-captain, or designates a player that is not a member of the persisted Fantasy_Team, THEN THE Draft_Service SHALL reject the designation and return an error with code `INVALID_CAPTAIN_SELECTION`.

### Requirement 6: Formation Validation

**User Story:** As a user, I want to set a starting formation, so that my starting lineup meets the competition's position rules.

#### Acceptance Criteria

1. WHEN a user submits a formation, THE Draft_Service SHALL validate that the count of starting players in each position is greater than or equal to the minimum and less than or equal to the maximum position counts defined in the Roster_Config.
2. WHEN a user submits a formation whose starting player count equals the Roster_Config starting lineup size and whose per-position counts satisfy all Roster_Config position constraints, THE Draft_Service SHALL persist the formation and return a confirmation indicating the formation was saved.
3. IF a user submits a formation that violates a Roster_Config position constraint, where a violation is a per-position count below its defined minimum or above its defined maximum, or a total starting player count not equal to the Roster_Config starting lineup size, THEN THE Draft_Service SHALL reject the formation without persisting any changes and return an error with code `INVALID_FORMATION`.
4. IF a user submits a formation that includes a starting player who is not a member of the persisted squad, THEN THE Draft_Service SHALL reject the formation without persisting any changes and return an error indicating that one or more selected players are not members of the squad.
5. WHILE the lineup deadline lock is active, THE Draft_Service SHALL reject any formation submission without persisting any changes and return an error indicating that the submission deadline has passed.

### Requirement 7: Transfers and Transfer Penalties

**User Story:** As a user, I want to transfer players between gameweeks, so that I can adjust my squad based on performance and availability.

#### Acceptance Criteria

1. WHEN a user submits a transfer before the Transfer_Deadline of the current gameweek, THE Transfer_Service SHALL replace the outgoing player with the incoming player, decrement the user's available transfer count for the current gameweek by 1, and record the transfer with a timestamp.
2. WHILE a user has 1 or more free transfers remaining for the current gameweek, THE Transfer_Service SHALL process each submitted transfer without applying a point penalty to the gameweek score.
3. WHEN a user submits a transfer after the free transfers for the current gameweek have reached 0, THE Transfer_Service SHALL deduct the configured penalty cost (a fixed non-negative point value per additional transfer, default 4 points) from the gameweek score for that transfer.
4. IF a user submits a transfer after the Transfer_Deadline of the current gameweek, THEN THE Transfer_Service SHALL reject the transfer, leave the squad unchanged, and return an error with code `TRANSFER_DEADLINE_PASSED`.
5. IF a user submits a transfer whose resulting squad price exceeds the competition budget, THEN THE Transfer_Service SHALL reject the transfer, leave the squad unchanged, and return an error with code `BUDGET_EXCEEDED`.
6. IF a user submits a transfer whose incoming player is already present in the Fantasy_Team's current squad, THEN THE Transfer_Service SHALL reject the transfer, leave the squad unchanged, and return an error with code `PLAYER_ALREADY_IN_SQUAD`.
7. WHEN a new gameweek begins, THE Transfer_Service SHALL grant the configured number of free transfers for that competition to each Fantasy_Team, adding any unused free transfers carried over from the previous gameweek up to a maximum accumulated cap of the configured carry-over limit (default 2 free transfers).
8. WHILE a Wildcard or Free Hit chip is active for the current gameweek on a Fantasy_Team, THE Transfer_Service SHALL process each transfer for that team without applying a point penalty and without decrementing the available transfer count.

### Requirement 8: Chip Activation

**User Story:** As a user, I want to activate special chips during a gameweek, so that I can gain strategic advantages.

#### Acceptance Criteria

1. WHEN a user activates a chip that is configured for the competition, has remaining uses, and no other chip is active for the current gameweek before the Transfer_Deadline, THE Gameweek_Service SHALL record the chip as active for the current gameweek and decrement that chip's remaining uses.
2. WHILE the Wildcard chip is active for a gameweek, THE Transfer_Service SHALL process all transfers in that gameweek without applying a point penalty.
3. WHILE the Triple Captain chip is active for a gameweek, THE Scoring_Engine SHALL multiply the captain's points by the competition-configured triple-captain multiplier for that gameweek.
4. WHILE the Bench Boost chip is active for a gameweek, THE Scoring_Engine SHALL include all bench players' points in the Fantasy_Team gameweek score.
5. WHILE the Free Hit chip is active for a gameweek, THE Gameweek_Service SHALL apply the squad changes only to that gameweek and restore the prior squad at the start of the next gameweek.
6. IF a user activates a chip that has no remaining uses, THEN THE Gameweek_Service SHALL reject the activation, leave the chip's remaining uses unchanged, leave any currently active chip unchanged, and return an error with code `CHIP_UNAVAILABLE`.
7. IF a user activates a chip after the Transfer_Deadline of the current gameweek, THEN THE Gameweek_Service SHALL reject the activation, leave the chip's remaining uses unchanged, leave any currently active chip unchanged, and return an error with code `TRANSFER_DEADLINE_PASSED`.
8. IF a user activates a chip while another chip is already active for the current gameweek, THEN THE Gameweek_Service SHALL reject the activation, leave the existing active chip and all chips' remaining uses unchanged, and return an error with code `CHIP_ALREADY_ACTIVE`.
9. IF a user activates a chip that is not configured for the competition, THEN THE Gameweek_Service SHALL reject the activation, leave all chips' remaining uses unchanged, and return an error with code `CHIP_NOT_CONFIGURED`.

### Requirement 8a: Transfer Deadline Enforcement

**User Story:** As a competition operator, I want squad changes locked at the gameweek deadline, so that scoring is fair across all participants.

#### Acceptance Criteria

1. IF a user submits a squad, transfer, captain, or chip change for a gameweek and the server's current UTC time is at or after that gameweek's Transfer_Deadline, THEN THE Gameweek_Service SHALL reject the change, leave the existing squad, captain, and chip state unchanged, and return an error response indicating that the Transfer_Deadline has passed.
2. WHILE the server's current UTC time is before a gameweek's Transfer_Deadline, THE Gameweek_Service SHALL accept squad, transfer, captain, and chip changes for that gameweek.
3. WHEN a user requests the current gameweek state, THE Gameweek_Service SHALL return the Transfer_Deadline as a UTC timestamp for that gameweek.
4. THE Gameweek_Service SHALL use the server-side UTC clock as the sole authoritative time source when evaluating whether a gameweek's Transfer_Deadline has been reached.

### Requirement 9: Auto-Substitution

**User Story:** As a user, I want automatic substitutions when a starting player does not play, so that I do not lose points from inactive players.

#### Acceptance Criteria

1. WHEN a gameweek is finalized and a starting player recorded zero minutes played, THE Gameweek_Service SHALL substitute that player with the bench player that has the highest substitution priority among bench players who recorded at least 1 minute played and whose substitution preserves the Roster_Config position constraints.
2. IF no bench player recorded at least 1 minute played and preserves the Roster_Config position constraints, THEN THE Gameweek_Service SHALL retain the original starting player in the lineup with that player's recorded points.
3. WHILE processing a finalized gameweek that contains two or more starting players who recorded zero minutes played, THE Gameweek_Service SHALL evaluate each inactive starter in ascending starting-lineup order and assign bench players in bench priority order, completing each substitution before evaluating the next inactive starter.
4. WHEN the designated captain recorded zero minutes played in a finalized gameweek and the vice-captain recorded at least 1 minute played, THE Gameweek_Service SHALL transfer the captain multiplier to the vice-captain.
5. IF both the designated captain and the vice-captain recorded zero minutes played in a finalized gameweek, THEN THE Gameweek_Service SHALL apply no captain multiplier for that gameweek and SHALL leave both players' base points unchanged.

### Requirement 10: Scoring Engine

**User Story:** As a user, I want my players to be scored from real match performance, so that my fantasy points reflect actual events.

#### Acceptance Criteria

1. WHEN the Scoring_Engine receives finalized player match statistics for a gameweek, THE Scoring_Engine SHALL compute each player's points by applying the competition Scoring_Ruleset, including per-every-N statistic rules, minutes-played threshold rules, and negative point deductions, and SHALL allow a player's resulting net point total to be negative.
2. THE Scoring_Engine SHALL compute each Fantasy_Team gameweek score as the sum of its starting players' points with the captain's points multiplied by the configured captain multiplier, whose default value is 2.
3. WHILE the Triple Captain chip is active for a gameweek, THE Scoring_Engine SHALL multiply the captain's points by 3 instead of the default multiplier of 2.
4. WHILE the Bench Boost chip is active for a gameweek, THE Scoring_Engine SHALL include all of that Fantasy_Team's bench players' points in the gameweek score in addition to the starting players' points.
5. WHEN the Scoring_Engine computes points during a live match window, THE Scoring_Engine SHALL mark the resulting gameweek score as a Provisional_Score.
6. WHEN the Scoring_Engine completes reconciliation for a gameweek, THE Scoring_Engine SHALL mark the resulting gameweek score as a Confirmed_Score.
7. IF the Scoring_Engine receives a point recomputation request for a gameweek whose score is a Confirmed_Score, THEN THE Scoring_Engine SHALL reject the recomputation, preserve the existing Confirmed_Score unchanged, and return an indication that the gameweek score is finalized.
8. WHEN a user requests a player's gameweek score, THE Scoring_Engine SHALL return a breakdown listing each scored statistic together with its signed per-statistic point value, where awarded points are positive and deductions are negative.
9. THE Scoring_Engine SHALL produce identical fantasy point totals for identical player statistics, Scoring_Ruleset, and active chips, regardless of computation order or number of retries.

### Requirement 11: Live Score Updates

**User Story:** As a user, I want to see scores update during live matches, so that I can follow my team in real time.

#### Acceptance Criteria

1. WHEN the Scoring_Engine publishes a score update event, THE Realtime_Service SHALL push the updated scores only to clients currently subscribed to the affected competition, and SHALL NOT push that update to clients not subscribed to that competition.
2. WHEN a Web_Client establishes a WebSocket connection with a valid, unexpired JWT, THE Realtime_Service SHALL register the client for live updates within 2 seconds of connection establishment.
3. IF a WebSocket connection request omits a JWT, presents an expired JWT, or presents a JWT that fails signature validation, THEN THE Realtime_Service SHALL reject the connection without registering the client and SHALL return a rejection indication identifying the reason as authentication failure.
4. WHEN a real-world scoring event occurs during a live match window, THE Platform SHALL reflect the corresponding fantasy score update to subscribed clients within 5 minutes (300 seconds) of the event being recorded by the Scoring_Engine.
5. WHEN a previously connected Web_Client re-establishes a WebSocket connection with a valid JWT after a dropped connection, THE Realtime_Service SHALL restore the client's prior competition subscriptions and resume live updates within 2 seconds of reconnection.
6. WHILE a Web_Client is subscribed to one or more competitions, THE Realtime_Service SHALL accept up to a maximum of 50 concurrent competition subscriptions per client, and IF a subscription request would exceed this limit, THEN THE Realtime_Service SHALL reject the additional subscription and return a rejection indication identifying the reason as subscription limit exceeded.

### Requirement 12: League Creation and Membership

**User Story:** As a user, I want to create and join leagues, so that I can compete with friends and the public.

#### Acceptance Criteria

1. WHEN an authenticated user creates a private league for a competition with a specified maximum member count between 2 and 100 inclusive, THE League_Service SHALL create the league and generate a join code of 8 alphanumeric characters that is unique across all active leagues.
2. WHEN a user submits a join code that matches an existing private league whose current member count is less than its maximum member count, and the user has a Fantasy_Team for that league's competition, THE League_Service SHALL add the user's Fantasy_Team to that league.
3. WHEN an authenticated user joins a public league whose current member count is less than its maximum member count, and the user has a Fantasy_Team for that league's competition, THE League_Service SHALL add the user's Fantasy_Team to that league.
4. IF a user attempts to join a league whose current member count equals its maximum member count, THEN THE League_Service SHALL reject the request, leave the league membership unchanged, and return an error with code `LEAGUE_FULL`.
5. IF a user submits a join code that matches no existing league, THEN THE League_Service SHALL reject the request and return an error with code `INVALID_JOIN_CODE`.
6. IF a user attempts to join a league whose competition the user has no Fantasy_Team for, THEN THE League_Service SHALL reject the request, leave the league membership unchanged, and return an error with code `NO_FANTASY_TEAM`.
7. IF a user attempts to join a league that the user's Fantasy_Team is already a member of, THEN THE League_Service SHALL reject the request, leave the league membership unchanged, and return an error with code `ALREADY_MEMBER`.

### Requirement 13: League Standings

**User Story:** As a league member, I want to see standings, so that I know my rank against other members.

#### Acceptance Criteria

1. WHERE a league uses classic scoring, THE League_Service SHALL rank members in descending order of cumulative total points, assigning rank 1 to the highest total.
2. WHERE a league uses head-to-head scoring, THE League_Service SHALL award 3 points for a match win, 1 point for a draw, and 0 points for a loss, and SHALL rank members in descending order of cumulative head-to-head points across all completed gameweeks.
3. WHEN two or more members have equal cumulative total points in a classic league, THE League_Service SHALL order the tied members by most recent completed gameweek score in descending order, and SHALL assign the same rank number to members still tied after this comparison.
4. WHEN two or more members have equal cumulative head-to-head points in a head-to-head league, THE League_Service SHALL order the tied members by cumulative total points in descending order, and SHALL assign the same rank number to members still tied after this comparison.
5. WHERE a league uses head-to-head scoring, THE League_Service SHALL generate a single round-robin fixture schedule in which each member is paired against every other member exactly once before any pairing repeats.
6. WHEN a league member requests standings, THE League_Service SHALL return within 3 seconds the ranked list of all league members, each entry including the member identifier, cumulative points value used for ranking, and assigned rank.
7. IF a league member requests standings for a league that contains fewer than 2 members, THEN THE League_Service SHALL return a single-entry standings list for the requesting member without an error.

### Requirement 14: League Chat

**User Story:** As a league member, I want to send messages in my league, so that I can interact with other members.

#### Acceptance Criteria

1. WHEN a league member submits a chat message of 1 to 500 characters (measured after trimming leading and trailing whitespace) to a league they belong to, THE League_Service SHALL persist the message with a server-assigned creation timestamp and deliver it to all connected league members through the Realtime_Service in ascending chronological order by creation timestamp.
2. IF a user submits a chat message to a league they do not belong to, THEN THE League_Service SHALL reject the message, retain no message data, and return an error with code `NOT_A_LEAGUE_MEMBER`.
3. IF a user submits a chat message exceeding 500 characters, THEN THE League_Service SHALL reject the message, retain no message data, and return an error with code `MESSAGE_TOO_LONG`.
4. IF a user submits a chat message that is empty or contains only whitespace after trimming, THEN THE League_Service SHALL reject the message, retain no message data, and return an error with code `EMPTY_MESSAGE`.
5. WHEN a league member requests chat history for a league they belong to, THE League_Service SHALL return persisted messages ordered by creation timestamp descending (most recent first) in pages of at most 50 messages, including a pagination token to retrieve the next page when more messages exist.

### Requirement 15: Roster, Fixture, and Price Synchronization

**User Story:** As a competition operator, I want player rosters, fixtures, and prices kept current, so that users play with accurate data.

#### Acceptance Criteria

1. WHEN the scheduled roster sync runs for an active competition, THE Data_Sync_Service SHALL update each existing player's availability and price from the competition's Data_Provider_Adapter, add any player present in the provider response but absent from the persisted roster, and mark any persisted player absent from the provider response as unavailable.
2. WHEN the scheduled fixture sync runs for an active competition, THE Data_Sync_Service SHALL update fixture kickoff times, venues, and statuses from the competition's Data_Provider_Adapter.
3. WHEN the scheduled price change job runs for an active competition, THE Data_Sync_Service SHALL recompute each player's price from transfer activity and append a price point to that player's price history.
4. WHEN the score sync runs during a live match window, THE Data_Sync_Service SHALL fetch match statistics and publish a `ScoreUpdated` event to the event bus.
5. IF the Data_Provider_Adapter returns a rate-limit response, THEN THE Data_Sync_Service SHALL retry the request using exponential backoff with a base delay of 1 second doubling on each attempt, capped at 60 seconds per wait, for a maximum of 5 attempts.
6. IF the Data_Provider_Adapter returns an outage response or does not respond within 30 seconds after the maximum of 5 retry attempts are exhausted, THEN THE Data_Sync_Service SHALL abort the current sync run without modifying any persisted player, fixture, or price state, and SHALL record a failure indication identifying the affected competition and sync type.
7. IF the Data_Provider_Adapter returns a response missing any required field for a record, THEN THE Data_Sync_Service SHALL reject that record, retain the existing persisted state for that record unchanged, and record a failure indication identifying the rejected record.
8. THE Data_Sync_Service SHALL produce the same persisted player and price state when the same sync input is processed more than once.

### Requirement 16: Competition Portability

**User Story:** As a platform operator, I want to add new competitions through configuration, so that the platform scales to new sports without frontend code changes.

#### Acceptance Criteria

1. WHEN an operator submits a Competition record containing all required configuration fields (sport, format, Roster_Config, transfer rules, schedule, Scoring_Ruleset reference, and data provider), THE Competition_Service SHALL persist the Competition with status `draft` and make it available for activation within 5 seconds.
2. IF an operator submits a Competition record that is missing one or more required configuration fields or references a Scoring_Ruleset, Data_Provider_Adapter, or Roster_Config that does not exist, THEN THE Competition_Service SHALL reject the submission, SHALL NOT persist the Competition, and SHALL return an error indication identifying each missing or invalid field.
3. WHEN a Competition status is set to `upcoming` or `active`, THE Web_Client SHALL render the competition using only the persisted competition configuration, without requiring frontend code changes or redeployment.
4. WHERE a Data_Provider_Adapter is configured for a competition, THE Data_Sync_Service SHALL invoke that adapter's roster, fixture, and live-score operations for that competition.
5. WHEN the Data_Provider_Adapter receives external provider statistics, THE Data_Provider_Adapter SHALL map each external statistic key to its corresponding key in the Platform's canonical statistic map.
6. IF the Data_Provider_Adapter receives an external statistic key that has no entry in the Platform's canonical statistic map, THEN THE Data_Provider_Adapter SHALL reject that statistic, SHALL NOT apply it to scoring, and SHALL emit an error indication identifying the unmapped statistic key.
7. WHEN the Scoring_Engine scores a competition, THE Scoring_Engine SHALL use the Scoring_Ruleset referenced by that competition's configuration.

### Requirement 17: API Request Validation and Response Format

**User Story:** As a client developer, I want consistent validated API responses, so that I can integrate reliably and securely.

#### Acceptance Criteria

1. WHEN the Platform processes a successful API request, THE Platform SHALL return a response containing a success indicator set to boolean true, a data payload, and a metadata object containing a request identifier and a timestamp expressed in UTC.
2. WHEN the Platform rejects an API request, THE Platform SHALL return a response containing a success indicator set to boolean false, an error object containing a machine-readable code and a human-readable message, and a metadata object containing a request identifier and a timestamp expressed in UTC.
3. WHEN the Platform receives an API request that includes a client-supplied request identifier, THE Platform SHALL reuse that identifier as the request identifier in the response metadata, and WHEN no client-supplied request identifier is present, THE Platform SHALL generate a request identifier for the response metadata.
4. WHEN the Platform receives an API request, THE Platform SHALL validate the request body against the endpoint's schema before performing any processing or state change.
5. IF an API request body fails schema validation, THEN THE Platform SHALL reject the request without applying any state change, preserving prior state, and return an error object with code `VALIDATION_ERROR`, a human-readable message, and field-level detail identifying each failing field and the reason it failed.
6. IF an API request body cannot be parsed, THEN THE Platform SHALL reject the request without applying any state change, preserving prior state, and return an error object with a code indicating the body could not be parsed and a human-readable message describing the parse failure.

### Requirement 18: Security Controls

**User Story:** As a platform operator, I want enforced security controls, so that user data and the platform are protected.

#### Acceptance Criteria

1. WHEN a client connects to the Platform over HTTP (non-HTTPS), THE Platform SHALL redirect the client to the equivalent HTTPS endpoint negotiated over TLS version 1.2 or higher.
2. THE Platform SHALL validate the Cognito-issued JWT signature, expiration time, and issuer on every authenticated API request.
3. IF an authenticated API request presents a JWT that is missing, expired, or fails signature or issuer validation, THEN THE Platform SHALL reject the request, SHALL NOT process the requested operation, and SHALL return an authentication error indicating the token is invalid.
4. WHEN a user exceeds 100 requests within a 60-second rolling window, THE Platform SHALL reject each additional request within that window and return an error with code `RATE_LIMIT_EXCEEDED`.
5. THE Platform SHALL store user data, including personally identifiable information (PII), in DynamoDB with encryption at rest enabled.
6. WHEN the Platform receives a cross-origin request from an origin that is not in the allowed origins list, THE Platform SHALL deny the cross-origin request.
7. THE Platform SHALL retrieve external data provider credentials from AWS Secrets Manager at runtime rather than from source code or configuration files, and SHALL use credentials that are rotated at intervals not exceeding 90 days.
8. WHEN the Platform receives a request containing SQL injection or cross-site scripting (XSS) attack patterns, THE Platform SHALL block the request at the CloudFront WAF and SHALL NOT forward it to backend services.
9. IF an authenticated API request contains input that exceeds the defined maximum length bounds or does not match the expected format for its field, THEN THE Platform SHALL reject the request, SHALL NOT persist the input, and SHALL return a validation error indicating which field failed validation.

### Requirement 19: Performance and Availability

**User Story:** As a user, I want fast and reliable responses during peak events, so that the platform stays usable on match days.

#### Acceptance Criteria

1. WHILE request load is at or below 10,000 concurrent users for a single competition, THE Platform SHALL serve read API requests with a 95th-percentile latency at or below 200 milliseconds.
2. WHILE request load is at or below 10,000 concurrent users for a single competition, THE Platform SHALL serve write API requests with a 95th-percentile latency at or below 500 milliseconds.
3. WHEN game-day request volume exceeds 10,000 concurrent users for a single competition, THE Platform SHALL enqueue scoring and synchronization workloads for asynchronous processing rather than rejecting them.
4. WHEN the Web_Client loads its initial route, THE Web_Client SHALL deliver an initial JavaScript payload at or below 200 kilobytes gzipped.
5. WHEN a scoring event is received, THE Platform SHALL reflect the updated scores in read API responses within 5 minutes of receipt.
6. THE Platform SHALL maintain a successful API response rate of at least 99.9 percent measured over each calendar month.
7. WHEN the Web_Client loads its initial route, THE Web_Client SHALL achieve a Lighthouse Performance score of at least 90.
