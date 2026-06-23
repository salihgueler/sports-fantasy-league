/**
 * Draft Service — squad submission and player pool operations.
 *
 * submitSquad: validates the squad via the pure validator, and on success
 * persists the FantasyTeam to DDB. On failure, the prior team is left unchanged.
 */

import { randomUUID } from 'node:crypto';
import { FantasyRepository, AppError, buildFantasyTeamKey } from '@fantasy/shared';
import type { SquadSlot, Player, RosterConfig, FantasyTeam } from '@fantasy/shared';
import { validateSquad } from './squad-validator.js';
import { validateFormation } from './formation-validator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlayerFilters {
  realTeamId?: string;
  position?: string;
  minPrice?: number;
  maxPrice?: number;
  minPoints?: number;
  maxPoints?: number;
  availability?: string;
}

export interface SubmitSquadInput {
  userId: string;
  competitionId: string;
  leagueId: string;
  teamName: string;
  squad: SquadSlot[];
}

export interface SubmitSquadResult {
  fantasyTeamId: string;
  remainingBudget: number;
}

export interface SetCaptaincyInput {
  fantasyTeamId: string;
  captainId: string;
  viceCaptainId: string;
}

export interface SetFormationInput {
  fantasyTeamId: string;
  formation: string;
  squad: SquadSlot[];
}

// ─── DynamoDB Item Shapes ───────────────────────────────────────────────────

interface CompetitionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  competitionId: string;
  rosterConfig: RosterConfig;
  status: string;
}

interface PlayerItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  playerId: string;
  name: string;
  position: string;
  realTeamId: string;
  competitionId: string;
  price: number;
  totalPoints: number;
  availability: string;
}

interface FantasyTeamItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  competitionId: string;
  name: string;
  squad: SquadSlot[];
  formation: string;
  budget: number;
  freeTransfers: number;
  totalPoints: number;
}

interface LeagueMembershipItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  leagueId: string;
  fantasyTeamId: string;
}

interface LeagueMetaItem extends Record<string, unknown> {
  memberCount?: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

export interface AutoPickResult {
  fantasyTeam: FantasyTeam;
}

export class DraftService {
  constructor(private readonly repo: FantasyRepository) {}

  /**
   * Get a fantasy team owned by the user, by its fantasyTeamId.
   * Throws TEAM_NOT_FOUND if the user has no such team.
   */
  async getTeamById(userId: string, fantasyTeamId: string): Promise<FantasyTeam> {
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    return this.toFantasyTeam(team);
  }

  /**
   * Create (or return existing) fantasy team for a user + competition.
   * Idempotent: if the user already has a team for the competition it is returned
   * unchanged, so the "create my team" action is safe to repeat.
   * New teams start with an empty squad and the full competition budget.
   */
  async createTeam(
    userId: string,
    input: { competitionId: string; teamName: string },
  ): Promise<FantasyTeam> {
    const { competitionId, teamName } = input;

    // Idempotency: return existing team for this user + competition if present
    const existing = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': `TEAM#${competitionId}#`,
      },
    });

    if (existing.items.length > 0) {
      return this.toFantasyTeam(existing.items[0]);
    }

    // Fetch competition for the starting budget
    const competitionItem = await this.repo.get<CompetitionItem>(
      `COMPETITION#${competitionId}`,
      'META',
    );

    if (!competitionItem) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    const fantasyTeamId = randomUUID();
    const leagueId = 'GLOBAL';

    const keys = buildFantasyTeamKey({
      userId,
      compId: competitionId,
      leagueId,
      totalPoints: 0,
    });

    const teamItem: FantasyTeamItem = {
      ...keys,
      fantasyTeamId,
      userId,
      leagueId,
      competitionId,
      name: teamName,
      squad: [],
      formation: '',
      budget: competitionItem.rosterConfig.budget,
      freeTransfers: 1,
      totalPoints: 0,
    };

    await this.repo.put(teamItem);

    return this.toFantasyTeam(teamItem);
  }

  /**
   * Replace the squad of an existing fantasy team after full validation.
   * Persists only on success; returns the remaining budget.
   */
  async updateSquad(
    userId: string,
    fantasyTeamId: string,
    squad: SquadSlot[],
  ): Promise<{ fantasyTeamId: string; remainingBudget: number }> {
    // 1. Fetch the existing team owned by this user
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    // 2. Fetch competition rosterConfig
    const competitionItem = await this.repo.get<CompetitionItem>(
      `COMPETITION#${team.competitionId}`,
      'META',
    );
    if (!competitionItem) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${team.competitionId} not found`);
    }
    const rosterConfig = competitionItem.rosterConfig;

    // 3. Fetch referenced players (same mapping as submitSquad)
    const playerIds = squad.map((slot) => slot.playerId);
    const players = new Map<string, Player>();
    await Promise.all(
      playerIds.map(async (playerId) => {
        const item = await this.repo.get<PlayerItem>(
          `COMPETITION#${team.competitionId}`,
          `PLAYER#${playerId}`,
        );
        if (item) {
          players.set(playerId, {
            playerId: item.playerId,
            name: item.name,
            position: item.position,
            realTeamId: item.realTeamId,
            competitionId: item.competitionId,
            price: item.price,
            totalPoints: item.totalPoints,
            availability: item.availability as Player['availability'],
          });
        }
      }),
    );

    // 4. Validate (pure)
    const validationResult = validateSquad(squad, players, rosterConfig, team.competitionId);
    if (!validationResult.valid) {
      const firstError = validationResult.errors[0];
      throw new AppError(firstError.code, firstError.message, {
        ...(firstError.details ?? {}),
        allErrors: validationResult.errors,
      });
    }

    const remainingBudget = validationResult.remainingBudget!;

    // 5. Persist (preserve existing keys via spread)
    await this.repo.put({ ...team, squad, budget: remainingBudget });

    return { fantasyTeamId, remainingBudget };
  }

  /**
   * List all fantasy teams owned by a user (one per competition).
   */
  async listTeams(userId: string): Promise<FantasyTeam[]> {
    const result = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: { ':pk': `USER#${userId}`, ':skPrefix': 'TEAM#' },
    });
    return result.items.map((item) => this.toFantasyTeam(item));
  }

  /**
   * Rename a fantasy team owned by the user.
   */
  async renameTeam(userId: string, fantasyTeamId: string, name: string): Promise<FantasyTeam> {
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    const updated = { ...team, name };
    await this.repo.put(updated);
    return this.toFantasyTeam(updated);
  }

  /**
   * Delete a fantasy team owned by the user, and clean up any league
   * memberships joined with that team (decrementing each league's member count).
   * League memberships created via the league-creator derived id are not matched
   * and are left untouched.
   */
  async deleteTeam(userId: string, fantasyTeamId: string): Promise<void> {
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    // Remove league memberships joined with this team (GSI1: USER#<id> / LEAGUE#<id>)
    const membershipResult = await this.repo.query<LeagueMembershipItem>({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      expressionAttributeValues: { ':pk': `USER#${userId}`, ':skPrefix': 'LEAGUE#' },
    });

    const toRemove = membershipResult.items.filter((m) => m.fantasyTeamId === fantasyTeamId);
    for (const membership of toRemove) {
      await this.repo.delete(membership.PK, membership.SK);
      const leagueItem = await this.repo.get<LeagueMetaItem>(
        `LEAGUE#${membership.leagueId}`,
        'META',
      );
      if (leagueItem && typeof leagueItem.memberCount === 'number' && leagueItem.memberCount > 0) {
        await this.repo.update(
          `LEAGUE#${membership.leagueId}`,
          'META',
          'SET memberCount = :c',
          undefined,
          { ':c': leagueItem.memberCount - 1 },
        );
      }
    }

    await this.repo.delete(team.PK, team.SK);
  }

  /**
   * Auto-pick fills empty squad slots with distinct competition players
   * satisfying position counts, per-real-world-team cap, and remaining budget.
   * If no valid selection exists, leaves the squad unchanged and throws AUTO_PICK_INFEASIBLE.
   */
  async autoPick(userId: string, fantasyTeamId: string): Promise<FantasyTeam> {
    // 1. Fetch the existing fantasy team
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk',
      expressionAttributeValues: { ':pk': `USER#${userId}`, ':teamId': fantasyTeamId },
      filterExpression: 'fantasyTeamId = :teamId',
    });

    const teamItem = teamResult.items.find((t) => t.fantasyTeamId === fantasyTeamId);
    if (!teamItem) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    const { competitionId, leagueId } = teamItem;
    const currentSquad = teamItem.squad ?? [];

    // 2. Fetch competition for rosterConfig
    const competitionItem = await this.repo.get<CompetitionItem>(
      `COMPETITION#${competitionId}`,
      'META',
    );

    if (!competitionItem) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    const rosterConfig = competitionItem.rosterConfig;

    // 3. Fetch all available players for the competition (players only — exclude
    //    fantasy-team items that share the COMP# GSI2 partition).
    const playerResult = await this.repo.query<PlayerItem>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'POINTS#' },
      scanIndexForward: false,
    });

    const allPlayers: Player[] = playerResult.items.map((item) => ({
      playerId: item.playerId,
      name: item.name,
      position: item.position,
      realTeamId: item.realTeamId,
      competitionId: item.competitionId,
      price: item.price,
      totalPoints: item.totalPoints,
      availability: item.availability as Player['availability'],
    }));

    // 4. Determine how many slots need filling
    const slotsToFill = rosterConfig.squadSize - currentSquad.length;
    if (slotsToFill <= 0) {
      // Squad is already full — return as-is
      return this.toFantasyTeam(teamItem);
    }

    // 5. Build current state tracking
    const currentPlayerIds = new Set(currentSquad.map((s) => s.playerId));

    // Count players per position already in squad
    const positionCounts = new Map<string, number>();
    for (const slot of currentSquad) {
      const player = allPlayers.find((p) => p.playerId === slot.playerId);
      if (player) {
        positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1);
      }
    }

    // Count players per real-world team already in squad
    const teamCounts = new Map<string, number>();
    for (const slot of currentSquad) {
      const player = allPlayers.find((p) => p.playerId === slot.playerId);
      if (player) {
        teamCounts.set(player.realTeamId, (teamCounts.get(player.realTeamId) ?? 0) + 1);
      }
    }

    // Compute current spent budget
    let spentBudget = 0;
    for (const slot of currentSquad) {
      const player = allPlayers.find((p) => p.playerId === slot.playerId);
      if (player) {
        spentBudget += player.price;
      }
    }
    let remainingBudget = rosterConfig.budget - spentBudget;

    // 6. Determine position requirements: how many more of each position we need
    // Calculate the minimum remaining slots per position
    const positionNeeds: Array<{ position: string; minNeeded: number; maxAllowed: number }> = [];
    for (const posConfig of rosterConfig.positions) {
      const current = positionCounts.get(posConfig.name) ?? 0;
      const minNeeded = Math.max(0, posConfig.min - current);
      const maxAllowed = posConfig.max - current;
      positionNeeds.push({ position: posConfig.name, minNeeded, maxAllowed });
    }

    // 7. Sort available players by totalPoints descending then price ascending (greedy best-value)
    const availablePlayers = allPlayers
      .filter((p) => !currentPlayerIds.has(p.playerId))
      .filter((p) => p.availability === 'available')
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        return a.price - b.price;
      });

    // 8. Greedy fill: first satisfy minimum position requirements, then fill remaining slots
    const picked: SquadSlot[] = [];

    // Phase 1: Fill minimum position requirements
    for (const need of positionNeeds) {
      let filled = 0;
      while (filled < need.minNeeded) {
        const candidate = availablePlayers.find(
          (p) =>
            p.position === need.position &&
            !currentPlayerIds.has(p.playerId) &&
            p.price <= remainingBudget &&
            (teamCounts.get(p.realTeamId) ?? 0) < rosterConfig.perTeamCap,
        );

        if (!candidate) {
          // Cannot satisfy minimum position requirement
          throw new AppError(
            'AUTO_PICK_INFEASIBLE',
            'Unable to fill squad within budget and roster constraints',
          );
        }

        picked.push({
          playerId: candidate.playerId,
          isCaptain: false,
          isViceCaptain: false,
          isBenched: false,
        });
        currentPlayerIds.add(candidate.playerId);
        positionCounts.set(candidate.position, (positionCounts.get(candidate.position) ?? 0) + 1);
        teamCounts.set(candidate.realTeamId, (teamCounts.get(candidate.realTeamId) ?? 0) + 1);
        remainingBudget -= candidate.price;

        // Remove from available pool
        const idx = availablePlayers.indexOf(candidate);
        if (idx !== -1) availablePlayers.splice(idx, 1);

        filled++;
      }
    }

    // Phase 2: Fill remaining slots with best available players respecting max position and team cap
    const remainingSlots = slotsToFill - picked.length;
    for (let i = 0; i < remainingSlots; i++) {
      const candidate = availablePlayers.find((p) => {
        const currentPosCount = positionCounts.get(p.position) ?? 0;
        // Check position max: the current count must be below the config max
        const posConfig = rosterConfig.positions.find((pc) => pc.name === p.position);
        if (!posConfig || currentPosCount >= posConfig.max) return false;
        // Check team cap
        if ((teamCounts.get(p.realTeamId) ?? 0) >= rosterConfig.perTeamCap) return false;
        // Check budget
        if (p.price > remainingBudget) return false;
        return true;
      });

      if (!candidate) {
        throw new AppError(
          'AUTO_PICK_INFEASIBLE',
          'Unable to fill squad within budget and roster constraints',
        );
      }

      picked.push({
        playerId: candidate.playerId,
        isCaptain: false,
        isViceCaptain: false,
        isBenched: false,
      });
      currentPlayerIds.add(candidate.playerId);
      positionCounts.set(candidate.position, (positionCounts.get(candidate.position) ?? 0) + 1);
      teamCounts.set(candidate.realTeamId, (teamCounts.get(candidate.realTeamId) ?? 0) + 1);
      remainingBudget -= candidate.price;

      const idx = availablePlayers.indexOf(candidate);
      if (idx !== -1) availablePlayers.splice(idx, 1);
    }

    // 9. Build the complete squad
    const fullSquad = [...currentSquad, ...picked];

    // 10. Persist the updated fantasy team
    const keys = buildFantasyTeamKey({
      userId,
      compId: competitionId,
      leagueId,
      totalPoints: teamItem.totalPoints,
    });

    const updatedTeamItem: FantasyTeamItem = {
      ...keys,
      fantasyTeamId: teamItem.fantasyTeamId,
      userId,
      leagueId,
      competitionId,
      name: teamItem.name,
      squad: fullSquad,
      formation: teamItem.formation,
      budget: remainingBudget,
      freeTransfers: teamItem.freeTransfers,
      totalPoints: teamItem.totalPoints,
    };

    await this.repo.put(updatedTeamItem);

    return this.toFantasyTeam(updatedTeamItem);
  }

  private toFantasyTeam(item: FantasyTeamItem): FantasyTeam {
    return {
      fantasyTeamId: item.fantasyTeamId,
      userId: item.userId,
      leagueId: item.leagueId,
      competitionId: item.competitionId,
      name: item.name,
      squad: item.squad,
      formation: item.formation,
      budget: item.budget,
      freeTransfers: item.freeTransfers,
      totalPoints: item.totalPoints,
    };
  }

  /**
   * Get the player pool for a competition, with optional filters.
   * Returns an empty list (not an error) when no players match.
   */
  async getPlayerPool(competitionId: string, filters?: PlayerFilters): Promise<Player[]> {
    // Query all players for this competition via GSI2.
    // Players use GSI2SK `POINTS#...`; fantasy teams share this partition with
    // `USER#...`, so filter by the POINTS# prefix to return players only.
    const result = await this.repo.query<PlayerItem>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      expressionAttributeValues: { ':pk': `COMP#${competitionId}`, ':sk': 'POINTS#' },
      scanIndexForward: false,
    });

    let players: Player[] = result.items.map((item) => ({
      playerId: item.playerId,
      name: item.name,
      position: item.position,
      realTeamId: item.realTeamId,
      competitionId: item.competitionId,
      price: item.price,
      totalPoints: item.totalPoints,
      availability: item.availability as Player['availability'],
    }));

    // Apply client-side filters
    if (filters) {
      if (filters.realTeamId) {
        players = players.filter((p) => p.realTeamId === filters.realTeamId);
      }
      if (filters.position) {
        players = players.filter((p) => p.position === filters.position);
      }
      if (filters.minPrice !== undefined) {
        players = players.filter((p) => p.price >= filters.minPrice!);
      }
      if (filters.maxPrice !== undefined) {
        players = players.filter((p) => p.price <= filters.maxPrice!);
      }
      if (filters.minPoints !== undefined) {
        players = players.filter((p) => p.totalPoints >= filters.minPoints!);
      }
      if (filters.maxPoints !== undefined) {
        players = players.filter((p) => p.totalPoints <= filters.maxPoints!);
      }
      if (filters.availability) {
        players = players.filter((p) => p.availability === filters.availability);
      }
    }

    return players;
  }

  /**
   * Submit a squad for a competition.
   *
   * 1. Fetch competition (for rosterConfig)
   * 2. Fetch all referenced players from DDB
   * 3. Run validateSquad (pure)
   * 4. If invalid → throw AppError with all errors
   * 5. If valid → persist the FantasyTeam to DDB
   * 6. Return { fantasyTeamId, remainingBudget }
   */
  async submitSquad(input: SubmitSquadInput): Promise<SubmitSquadResult> {
    const { userId, competitionId, leagueId, teamName, squad } = input;

    // 1. Fetch competition for rosterConfig
    const competitionItem = await this.repo.get<CompetitionItem>(
      `COMPETITION#${competitionId}`,
      'META',
    );

    if (!competitionItem) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    const rosterConfig = competitionItem.rosterConfig;

    // 2. Fetch all referenced players from DDB
    const playerIds = squad.map((slot) => slot.playerId);
    const players = new Map<string, Player>();

    // Fetch each player individually (they share the competition PK)
    const playerFetches = playerIds.map(async (playerId) => {
      const item = await this.repo.get<PlayerItem>(
        `COMPETITION#${competitionId}`,
        `PLAYER#${playerId}`,
      );
      if (item) {
        players.set(playerId, {
          playerId: item.playerId,
          name: item.name,
          position: item.position,
          realTeamId: item.realTeamId,
          competitionId: item.competitionId,
          price: item.price,
          totalPoints: item.totalPoints,
          availability: item.availability as Player['availability'],
        });
      }
    });

    await Promise.all(playerFetches);

    // 3. Run pure validation
    const validationResult = validateSquad(squad, players, rosterConfig, competitionId);

    // 4. If invalid → throw with the first error (include all in details)
    if (!validationResult.valid) {
      const firstError = validationResult.errors[0];
      throw new AppError(firstError.code, firstError.message, {
        ...(firstError.details ?? {}),
        allErrors: validationResult.errors,
      });
    }

    // 5. Persist the FantasyTeam
    const fantasyTeamId = randomUUID();
    const remainingBudget = validationResult.remainingBudget!;

    const keys = buildFantasyTeamKey({
      userId,
      compId: competitionId,
      leagueId,
      totalPoints: 0,
    });

    const teamItem: FantasyTeamItem = {
      ...keys,
      fantasyTeamId,
      userId,
      leagueId,
      competitionId,
      name: teamName,
      squad,
      formation: '',
      budget: remainingBudget,
      freeTransfers: 0,
      totalPoints: 0,
    };

    await this.repo.put(teamItem);

    // 6. Return result
    return { fantasyTeamId, remainingBudget };
  }

  /**
   * Set captain and vice-captain for a fantasy team.
   *
   * Validates:
   *  - captainId ≠ viceCaptainId
   *  - Both players are members of the squad
   *
   * On failure → throws AppError('INVALID_CAPTAIN_SELECTION')
   * On success → persists updated captain/vice-captain flags on the squad
   */
  async setCaptaincy(userId: string, input: SetCaptaincyInput): Promise<void> {
    const { fantasyTeamId, captainId, viceCaptainId } = input;

    // 1. Captain and vice-captain must be different players
    if (captainId === viceCaptainId) {
      throw new AppError(
        'INVALID_CAPTAIN_SELECTION',
        'Captain and vice-captain must be different players',
      );
    }

    // 2. Fetch the fantasy team — query by userId PK with TEAM# SK prefix
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('INVALID_CAPTAIN_SELECTION', 'Fantasy team not found for this user');
    }

    // 3. Verify both players are in the squad
    const squadPlayerIds = new Set(team.squad.map((s) => s.playerId));
    if (!squadPlayerIds.has(captainId) || !squadPlayerIds.has(viceCaptainId)) {
      throw new AppError(
        'INVALID_CAPTAIN_SELECTION',
        'Captain and vice-captain must be members of the squad',
      );
    }

    // 4. Update squad slots: clear old flags, set new captain/vice-captain
    const updatedSquad: SquadSlot[] = team.squad.map((slot) => ({
      ...slot,
      isCaptain: slot.playerId === captainId,
      isViceCaptain: slot.playerId === viceCaptainId,
    }));

    // 5. Persist the updated team
    const updatedTeam: FantasyTeamItem = {
      ...team,
      squad: updatedSquad,
    };

    await this.repo.put(updatedTeam);
  }

  /**
   * Set formation for a fantasy team.
   *
   * Validates:
   *  - Starting lineup count equals rosterConfig.startingXI
   *  - Per-position min/max within the starting lineup
   *  - All starting players are members of the persisted squad
   *
   * On failure → throws AppError('INVALID_FORMATION' or 'PLAYER_NOT_IN_SQUAD') without persisting
   * On success → persists the updated squad with new benched/starting assignments and formation string
   */
  async setFormation(userId: string, input: SetFormationInput): Promise<void> {
    const { fantasyTeamId, formation, squad: proposedSquad } = input;

    // 1. Fetch the fantasy team — query by userId PK with TEAM# SK prefix
    const teamResult = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = teamResult.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', 'Fantasy team not found for this user');
    }

    // 2. Fetch competition for rosterConfig
    const competitionItem = await this.repo.get<CompetitionItem>(
      `COMPETITION#${team.competitionId}`,
      'META',
    );

    if (!competitionItem) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${team.competitionId} not found`);
    }

    const rosterConfig = competitionItem.rosterConfig;

    // 3. Build a set of player IDs in the persisted squad
    const existingSquadPlayerIds = new Set(team.squad.map((s) => s.playerId));

    // 4. Build player lookup map from DDB for position resolution
    const starterPlayerIds = proposedSquad.filter((s) => !s.isBenched).map((s) => s.playerId);

    const players = new Map<string, Player>();
    const playerFetches = starterPlayerIds.map(async (playerId) => {
      const item = await this.repo.get<PlayerItem>(
        `COMPETITION#${team.competitionId}`,
        `PLAYER#${playerId}`,
      );
      if (item) {
        players.set(playerId, {
          playerId: item.playerId,
          name: item.name,
          position: item.position,
          realTeamId: item.realTeamId,
          competitionId: item.competitionId,
          price: item.price,
          totalPoints: item.totalPoints,
          availability: item.availability as Player['availability'],
        });
      }
    });

    await Promise.all(playerFetches);

    // 5. Run pure validation
    const validationResult = validateFormation(
      proposedSquad,
      players,
      rosterConfig,
      existingSquadPlayerIds,
    );

    // 6. If invalid → throw without persisting
    if (!validationResult.valid) {
      const firstError = validationResult.errors[0];
      throw new AppError(firstError.code, firstError.message, {
        ...(firstError.details ?? {}),
        allErrors: validationResult.errors,
      });
    }

    // 7. Persist the updated squad with new benched/starting assignments
    const updatedTeam: FantasyTeamItem = {
      ...team,
      squad: proposedSquad,
      formation,
    };

    await this.repo.put(updatedTeam);
  }
}
