/**
 * League Service — league creation with unique join codes.
 *
 * createLeague: Validates maxMembers 2–100, generates an 8-character alphanumeric
 * join code unique across active leagues (GSI2 lookup), persists the league,
 * and adds the creator as the first member.
 */

import { randomUUID, randomInt } from 'node:crypto';
import {
  FantasyRepository,
  AppError,
  buildLeagueKey,
  buildLeagueMembershipKey,
  buildH2HFixtureKey,
  buildChatMessageKey,
} from '@fantasy/shared';
import type { League, ChatMessage } from '@fantasy/shared';
import type { CreateLeagueInput, StandingsEntry } from '@fantasy/shared';
import { generateRoundRobinSchedule, type H2HFixture } from './h2h-schedule.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const JOIN_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const JOIN_CODE_LENGTH = 8;
const MAX_JOIN_CODE_RETRIES = 10;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 100;

const CHAT_MAX_BODY_LENGTH = 500;
const CHAT_PAGE_SIZE = 50;

// ─── DynamoDB Item Shapes ───────────────────────────────────────────────────

interface LeagueItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  leagueId: string;
  name: string;
  competitionId: string;
  type: 'classic' | 'h2h';
  maxMembers: number;
  joinCode: string;
  isPublic: boolean;
  createdBy: string;
  memberCount: number;
  createdAt: string;
}

interface LeagueMembershipItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  leagueId: string;
  fantasyTeamId: string;
  userId: string;
  joinedAt: string;
}

interface FantasyTeamItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  competitionId: string;
  name: string;
  totalPoints: number;
}

interface LeagueMemberItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  leagueId: string;
  fantasyTeamId: string;
  userId: string;
  teamName?: string;
  totalPoints?: number;
  joinedAt: string;
}

interface H2HFixtureItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  leagueId: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  homePoints: number;
  awayPoints: number;
  pairId: string;
}

interface GameweekScoreItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  gameweek: number;
  points: number;
  scoreStatus?: string;
}

interface ChatMessageItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  messageId: string;
  leagueId: string;
  userId: string;
  body: string;
  createdAt: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class LeagueService {
  constructor(private readonly repo: FantasyRepository) {}

  /**
   * Create a new league with a unique 8-character alphanumeric join code.
   * The creator is automatically added as the first member.
   *
   * @param userId - The authenticated user creating the league
   * @param input - League creation parameters (validated by Zod schema upstream)
   * @returns The created League
   */
  async createLeague(userId: string, input: CreateLeagueInput): Promise<League> {
    // Validate maxMembers within the 2–100 range per R12.1
    if (input.maxMembers < MIN_MEMBERS || input.maxMembers > MAX_MEMBERS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `maxMembers must be between ${MIN_MEMBERS} and ${MAX_MEMBERS}`,
        { fields: { maxMembers: `Must be between ${MIN_MEMBERS} and ${MAX_MEMBERS}` } },
      );
    }

    // Generate a unique join code
    const joinCode = await this.generateUniqueJoinCode();

    // Create the league
    const leagueId = randomUUID();
    const now = new Date().toISOString();

    const keys = buildLeagueKey({ leagueId, compId: input.competitionId, joinCode });

    const leagueItem: LeagueItem = {
      ...keys,
      leagueId,
      name: input.name,
      competitionId: input.competitionId,
      type: input.type,
      maxMembers: input.maxMembers,
      joinCode,
      isPublic: input.isPublic,
      createdBy: userId,
      memberCount: 1,
      createdAt: now,
    };

    await this.repo.put(leagueItem);

    // Add the creator as the first member.
    // The fantasyTeamId is derived from userId + competitionId.
    const fantasyTeamId = `${userId}:${input.competitionId}`;

    const memberKeys = buildLeagueMembershipKey({ leagueId, fantasyTeamId, userId });

    const memberItem: LeagueMembershipItem = {
      ...memberKeys,
      leagueId,
      fantasyTeamId,
      userId,
      joinedAt: now,
    };

    await this.repo.put(memberItem);

    return {
      leagueId,
      name: input.name,
      competitionId: input.competitionId,
      type: input.type,
      maxMembers: input.maxMembers,
      joinCode,
      isPublic: input.isPublic,
    };
  }

  /**
   * List public leagues for a competition (for the public-league browser).
   * Uses GSI1 (COMP#<id> / LEAGUE#<id>) and filters to public leagues.
   */
  async listPublicLeagues(competitionId: string): Promise<
    Array<{
      leagueId: string;
      name: string;
      competitionId: string;
      type: 'classic' | 'h2h';
      memberCount: number;
      maxMembers: number;
    }>
  > {
    const result = await this.repo.query<LeagueItem>({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':skPrefix': 'LEAGUE#' },
    });

    return result.items
      .filter((league) => league.isPublic)
      .map((league) => ({
        leagueId: league.leagueId,
        name: league.name,
        competitionId: league.competitionId,
        type: league.type,
        memberCount: league.memberCount ?? 0,
        maxMembers: league.maxMembers,
      }));
  }

  /**
   * List leagues the user belongs to (created or joined), via GSI1 membership
   * lookup (USER#<id> / LEAGUE#<id>), then resolving each league's metadata.
   */
  async listMyLeagues(userId: string): Promise<
    Array<{
      leagueId: string;
      name: string;
      competitionId: string;
      type: 'classic' | 'h2h';
      memberCount: number;
      maxMembers: number;
      isPublic: boolean;
      joinCode: string;
      isCreator: boolean;
    }>
  > {
    const memberships = await this.repo.query<LeagueMembershipItem>({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      expressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'LEAGUE#' },
    });

    const leagueIds = Array.from(new Set(memberships.items.map((m) => m.leagueId)));
    const leagues = await Promise.all(
      leagueIds.map((id) => this.repo.get<LeagueItem>(`LEAGUE#${id}`, 'META')),
    );

    return leagues
      .filter((league): league is LeagueItem => league !== undefined)
      .map((league) => ({
        leagueId: league.leagueId,
        name: league.name,
        competitionId: league.competitionId,
        type: league.type,
        memberCount: league.memberCount ?? 0,
        maxMembers: league.maxMembers,
        isPublic: league.isPublic,
        joinCode: league.joinCode,
        isCreator: league.createdBy === userId,
      }));
  }

  /**
   * Delete a league and everything under its partition (metadata, memberships,
   * H2H fixtures, chat messages). Only the league creator may delete it.
   */
  async deleteLeague(userId: string, leagueId: string): Promise<void> {
    const league = await this.repo.get<LeagueItem>(`LEAGUE#${leagueId}`, 'META');

    if (!league) {
      throw new AppError('LEAGUE_NOT_FOUND', `League ${leagueId} not found`);
    }

    if (league.createdBy !== userId) {
      throw new AppError('FORBIDDEN', 'Only the league owner can delete this league');
    }

    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.repo.query<{ PK: string; SK: string } & Record<string, unknown>>({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': `LEAGUE#${leagueId}` },
        exclusiveStartKey: startKey,
      });
      for (const item of result.items) {
        await this.repo.delete(item.PK, item.SK);
      }
      startKey = result.lastEvaluatedKey;
    } while (startKey);
  }

  /**
   * Generate a round-robin H2H schedule for a league.
   *
   * Uses the circle method to produce (n-1) rounds where every member meets
   * every other member exactly once before any repeat.
   *
   * The schedule is deterministic: given the same set of members, it always
   * produces the same pairings in the same order.
   *
   * @param leagueId - The league to generate the schedule for
   * @returns Array of H2HFixture objects representing the full round-robin
   * @throws AppError('LEAGUE_NOT_FOUND') if the league doesn't exist
   * @throws AppError('INSUFFICIENT_MEMBERS') if fewer than 2 members
   */
  async generateH2HSchedule(leagueId: string): Promise<H2HFixture[]> {
    // 1. Verify the league exists
    const leagueItem = await this.repo.get<LeagueItem>(`LEAGUE#${leagueId}`, 'META');

    if (!leagueItem) {
      throw new AppError('LEAGUE_NOT_FOUND', `League ${leagueId} not found`);
    }

    // 2. Fetch all league members
    const memberResult = await this.repo.query<LeagueMembershipItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `LEAGUE#${leagueId}`,
        ':skPrefix': 'MEMBER#',
      },
    });

    const memberIds = memberResult.items.map((m) => m.fantasyTeamId);

    if (memberIds.length < 2) {
      throw new AppError(
        'INSUFFICIENT_MEMBERS',
        'At least 2 members are required to generate an H2H schedule',
      );
    }

    // 3. Generate the round-robin schedule (pure, deterministic)
    const fixtures = generateRoundRobinSchedule(memberIds);

    // 4. Persist each fixture to DDB
    const writePromises = fixtures.map((fixture) => {
      const keys = buildH2HFixtureKey({
        leagueId,
        round: fixture.round,
        pairId: fixture.pairId,
      });

      const item: Record<string, unknown> = {
        ...keys,
        leagueId,
        round: fixture.round,
        teamA: fixture.teamA,
        teamB: fixture.teamB,
        pairId: fixture.pairId,
      };

      return this.repo.put(item);
    });

    await Promise.all(writePromises);

    return fixtures;
  }

  /**
   * Join a league by its 8-character join code.
   *
   * Guards (validated in order, reject on first failure):
   * 1. League exists (GSI2 lookup by join code) → INVALID_JOIN_CODE
   * 2. League is below max members → LEAGUE_FULL
   * 3. User has a fantasy team for the competition → NO_FANTASY_TEAM
   * 4. User is not already a member → ALREADY_MEMBER
   */
  async joinByCode(userId: string, joinCode: string): Promise<void> {
    // 1. Resolve league by join code via GSI2
    const leagueResult = await this.repo.query<LeagueItem>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
      expressionAttributeValues: {
        ':pk': `JOINCODE#${joinCode}`,
        ':sk': 'LEAGUE',
      },
    });

    const league = leagueResult.items[0];
    if (!league) {
      throw new AppError('INVALID_JOIN_CODE', 'No league found for the provided join code');
    }

    await this.joinLeague(userId, league);
  }

  /**
   * Join a public league by its league ID.
   *
   * Guards (validated in order, reject on first failure):
   * 1. League exists (direct get by leagueId) → LEAGUE_NOT_FOUND
   * 2. League is below max members → LEAGUE_FULL
   * 3. User has a fantasy team for the competition → NO_FANTASY_TEAM
   * 4. User is not already a member → ALREADY_MEMBER
   */
  async joinPublic(userId: string, leagueId: string): Promise<void> {
    // 1. Resolve league by direct get
    const league = await this.repo.get<LeagueItem>(`LEAGUE#${leagueId}`, 'META');

    if (!league) {
      throw new AppError('LEAGUE_NOT_FOUND', `League ${leagueId} not found`);
    }

    await this.joinLeague(userId, league);
  }

  /**
   * Get standings for a league.
   *
   * Classic: descending cumulative total points, tie-break by most recent
   * completed gameweek score, shared ranks (R13.1, R13.2).
   *
   * H2H: 3 pts for win, 1 for draw, 0 for loss; descending H2H points,
   * tie-break by cumulative total points, shared ranks (R13.3, R13.4).
   *
   * Returns a single-entry list for leagues with fewer than 2 members (R13.7).
   */
  async getStandings(leagueId: string): Promise<StandingsEntry[]> {
    // Fetch league metadata to determine scoring type
    const leagueMeta = await this.repo.get<LeagueItem>(`LEAGUE#${leagueId}`, 'META');

    if (!leagueMeta) {
      throw new AppError('LEAGUE_NOT_FOUND', `League ${leagueId} not found`);
    }

    // Fetch all members (SK begins_with MEMBER#)
    const membersResult = await this.repo.query<LeagueMemberItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `LEAGUE#${leagueId}`,
        ':skPrefix': 'MEMBER#',
      },
    });

    const members = membersResult.items;

    // R13.7: fewer than 2 members → single-entry list
    if (members.length < 2) {
      if (members.length === 0) {
        return [];
      }
      const member = members[0];
      return [
        {
          fantasyTeamId: member.fantasyTeamId,
          teamName: member.teamName ?? '',
          userId: member.userId,
          rank: 1,
          totalPoints: member.totalPoints ?? 0,
          gameweekPoints: 0,
        },
      ];
    }

    if (leagueMeta.type === 'h2h') {
      return this.computeH2HStandings(leagueId, members);
    }

    return this.computeClassicStandings(members);
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────

  /**
   * Post a chat message to a league.
   *
   * Validates:
   * - Body trimmed must be 1–500 characters → EMPTY_MESSAGE / MESSAGE_TOO_LONG
   * - User must be a league member → NOT_A_LEAGUE_MEMBER
   *
   * Persists with a server-generated UTC timestamp and unique message ID.
   */
  async postMessage(userId: string, leagueId: string, body: string): Promise<ChatMessage> {
    const trimmed = body.trim();

    if (trimmed.length === 0) {
      throw new AppError('EMPTY_MESSAGE', 'Message body cannot be empty');
    }

    if (trimmed.length > CHAT_MAX_BODY_LENGTH) {
      throw new AppError(
        'MESSAGE_TOO_LONG',
        `Message body exceeds maximum of ${CHAT_MAX_BODY_LENGTH} characters`,
      );
    }

    // Check membership via GSI1: USER#<userId> / LEAGUE#<leagueId>
    const membershipResult = await this.repo.query<LeagueMembershipItem>({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `LEAGUE#${leagueId}`,
      },
      limit: 1,
    });

    if (membershipResult.items.length === 0) {
      throw new AppError('NOT_A_LEAGUE_MEMBER', 'You must be a league member to post messages');
    }

    const msgId = randomUUID();
    const createdAt = new Date().toISOString();

    const keys = buildChatMessageKey({ leagueId, createdTs: createdAt, msgId });

    const item: ChatMessageItem = {
      ...keys,
      messageId: msgId,
      leagueId,
      userId,
      body: trimmed,
      createdAt,
    };

    await this.repo.put(item);

    return {
      messageId: msgId,
      leagueId,
      userId,
      body: trimmed,
      createdAt,
    };
  }

  /**
   * Get chat history for a league (most recent first).
   *
   * Returns pages of up to 50 messages in descending order.
   * Supports cursor-based pagination via an opaque page token.
   */
  async getChatHistory(
    leagueId: string,
    pageToken?: string,
  ): Promise<{ messages: ChatMessage[]; nextPageToken?: string }> {
    let exclusiveStartKey: Record<string, unknown> | undefined;

    if (pageToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(pageToken, 'base64url').toString('utf-8'));
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid page token');
      }
    }

    const result = await this.repo.query<ChatMessageItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `LEAGUE#${leagueId}`,
        ':skPrefix': 'MSG#',
      },
      scanIndexForward: false,
      limit: CHAT_PAGE_SIZE,
      exclusiveStartKey,
    });

    const messages: ChatMessage[] = result.items.map((item) => ({
      messageId: item.messageId,
      leagueId: item.leagueId,
      userId: item.userId,
      body: item.body,
      createdAt: item.createdAt,
    }));

    let nextPageToken: string | undefined;
    if (result.lastEvaluatedKey) {
      nextPageToken = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url');
    }

    return { messages, nextPageToken };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Classic standings: descending cumulative total points.
   * Tie-break: most recent completed gameweek score (descending).
   * Shared ranks for still-tied members.
   */
  private async computeClassicStandings(members: LeagueMemberItem[]): Promise<StandingsEntry[]> {
    // Fetch most recent gameweek score for each member
    const recentGwScores = await Promise.all(
      members.map((m) => this.getMostRecentGameweekScore(m.fantasyTeamId)),
    );

    // Build sortable entries
    const entries = members.map((m, i) => ({
      fantasyTeamId: m.fantasyTeamId,
      teamName: m.teamName ?? '',
      userId: m.userId,
      totalPoints: m.totalPoints ?? 0,
      gameweekPoints: recentGwScores[i],
    }));

    // Sort: descending totalPoints, then descending gameweekPoints (tie-break)
    entries.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }
      return b.gameweekPoints - a.gameweekPoints;
    });

    // Assign shared ranks: compare totalPoints and gameweekPoints
    return this.assignSharedRanks(entries, (entry) => [entry.totalPoints, entry.gameweekPoints]);
  }

  /**
   * H2H standings: 3 pts for win, 1 for draw, 0 for loss.
   * Descending cumulative H2H points.
   * Tie-break: cumulative total points (descending).
   * Shared ranks for still-tied members.
   */
  private async computeH2HStandings(
    leagueId: string,
    members: LeagueMemberItem[],
  ): Promise<StandingsEntry[]> {
    // Query all H2H fixtures for the league (SK begins_with H2H#)
    const h2hResult = await this.repo.query<H2HFixtureItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `LEAGUE#${leagueId}`,
        ':skPrefix': 'H2H#',
      },
    });

    const fixtures = h2hResult.items;

    // Calculate H2H points per team (3 for win, 1 for draw, 0 for loss)
    const h2hPointsMap = new Map<string, number>();
    for (const member of members) {
      h2hPointsMap.set(member.fantasyTeamId, 0);
    }

    for (const fixture of fixtures) {
      const { homeTeamId, awayTeamId, homePoints, awayPoints } = fixture;

      if (homePoints > awayPoints) {
        h2hPointsMap.set(homeTeamId, (h2hPointsMap.get(homeTeamId) ?? 0) + 3);
      } else if (homePoints < awayPoints) {
        h2hPointsMap.set(awayTeamId, (h2hPointsMap.get(awayTeamId) ?? 0) + 3);
      } else {
        // Draw
        h2hPointsMap.set(homeTeamId, (h2hPointsMap.get(homeTeamId) ?? 0) + 1);
        h2hPointsMap.set(awayTeamId, (h2hPointsMap.get(awayTeamId) ?? 0) + 1);
      }
    }

    // Build sortable entries
    // For H2H standings, gameweekPoints holds cumulative H2H points for display
    const entries = members.map((m) => ({
      fantasyTeamId: m.fantasyTeamId,
      teamName: m.teamName ?? '',
      userId: m.userId,
      totalPoints: m.totalPoints ?? 0,
      gameweekPoints: h2hPointsMap.get(m.fantasyTeamId) ?? 0,
    }));

    // Sort: descending H2H points (gameweekPoints), tie-break by totalPoints desc
    entries.sort((a, b) => {
      if (b.gameweekPoints !== a.gameweekPoints) {
        return b.gameweekPoints - a.gameweekPoints;
      }
      return b.totalPoints - a.totalPoints;
    });

    // Assign shared ranks: compare H2H points then total points
    return this.assignSharedRanks(entries, (entry) => [entry.gameweekPoints, entry.totalPoints]);
  }

  /**
   * Get the most recent gameweek score for a team.
   * Queries TEAM#<id> with SK begins_with GWSCORE# in descending order (limit 1).
   */
  private async getMostRecentGameweekScore(fantasyTeamId: string): Promise<number> {
    const result = await this.repo.query<GameweekScoreItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `TEAM#${fantasyTeamId}`,
        ':skPrefix': 'GWSCORE#',
      },
      scanIndexForward: false, // descending by SK → most recent GW first
      limit: 1,
    });

    if (result.items.length === 0) {
      return 0;
    }

    return result.items[0].points ?? 0;
  }

  /**
   * Assign shared ranks to sorted entries.
   * Entries with equal sort keys get the same rank.
   * The next distinct entry gets rank = position + 1 (standard competition ranking).
   */
  private assignSharedRanks(
    sortedEntries: Array<{
      fantasyTeamId: string;
      teamName: string;
      userId: string;
      totalPoints: number;
      gameweekPoints: number;
    }>,
    getCompareKeys: (entry: { totalPoints: number; gameweekPoints: number }) => number[],
  ): StandingsEntry[] {
    const result: StandingsEntry[] = [];

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      let rank: number;

      if (i === 0) {
        rank = 1;
      } else {
        const prevKeys = getCompareKeys(sortedEntries[i - 1]);
        const currKeys = getCompareKeys(entry);
        const isTied = prevKeys.every((val, idx) => val === currKeys[idx]);
        rank = isTied ? result[i - 1].rank : i + 1;
      }

      result.push({
        fantasyTeamId: entry.fantasyTeamId,
        teamName: entry.teamName,
        userId: entry.userId,
        rank,
        totalPoints: entry.totalPoints,
        gameweekPoints: entry.gameweekPoints,
      });
    }

    return result;
  }

  /**
   * Internal: shared join logic with all guard checks.
   * Called by both joinByCode and joinPublic after league resolution.
   */
  private async joinLeague(userId: string, league: LeagueItem): Promise<void> {
    const { leagueId, competitionId, maxMembers } = league;

    // 2. Check league is below max members
    const membersResult = await this.repo.query<LeagueMembershipItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `LEAGUE#${leagueId}`,
        ':skPrefix': 'MEMBER#',
      },
    });

    const currentMemberCount = membersResult.items.length;
    if (currentMemberCount >= maxMembers) {
      throw new AppError('LEAGUE_FULL', 'This league has reached its maximum member count');
    }

    // 3. Check user has a fantasy team for the competition
    const teamsResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': `TEAM#${competitionId}`,
      },
    });

    if (teamsResult.items.length === 0) {
      throw new AppError(
        'NO_FANTASY_TEAM',
        'You must have a fantasy team for this competition to join the league',
      );
    }

    const fantasyTeam = teamsResult.items[0];

    // 4. Check user is not already a member (via GSI1: USER#userId / LEAGUE#leagueId)
    const existingMembership = await this.repo.query<LeagueMembershipItem>({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `LEAGUE#${leagueId}`,
      },
    });

    if (existingMembership.items.length > 0) {
      throw new AppError('ALREADY_MEMBER', 'You are already a member of this league');
    }

    // 5. Persist membership
    const keys = buildLeagueMembershipKey({
      leagueId,
      fantasyTeamId: fantasyTeam.fantasyTeamId,
      userId,
    });

    const membershipItem: LeagueMembershipItem = {
      ...keys,
      leagueId,
      fantasyTeamId: fantasyTeam.fantasyTeamId,
      userId,
      joinedAt: new Date().toISOString(),
    };

    await this.repo.put(membershipItem);

    // Keep the denormalized member count in sync (used by the public-league browser).
    await this.repo.update(`LEAGUE#${leagueId}`, 'META', 'SET memberCount = :c', undefined, {
      ':c': currentMemberCount + 1,
    });
  }

  /**
   * Generate an 8-character alphanumeric (uppercase + digits) join code
   * that is unique across active leagues. Uses GSI2 lookup for collision detection.
   */
  private async generateUniqueJoinCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_JOIN_CODE_RETRIES; attempt++) {
      const code = this.generateRandomCode();

      // Check uniqueness via GSI2: JOINCODE#<code>
      const existing = await this.repo.query<Record<string, unknown>>({
        indexName: 'GSI2',
        keyConditionExpression: 'GSI2PK = :pk',
        expressionAttributeValues: { ':pk': `JOINCODE#${code}` },
        limit: 1,
      });

      if (existing.items.length === 0) {
        return code;
      }
    }

    throw new AppError(
      'INTERNAL_ERROR',
      'Unable to generate a unique join code after maximum retries',
    );
  }

  /**
   * Generate a random 8-character string from [A-Z0-9].
   */
  private generateRandomCode(): string {
    let code = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_CODE_CHARS[randomInt(JOIN_CODE_CHARS.length)];
    }
    return code;
  }
}
