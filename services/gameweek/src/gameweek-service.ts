/**
 * Gameweek Service — deadline enforcement, chip activation, Free Hit
 * squad restoration, and auto-substitution during finalization.
 *
 * Responsibilities:
 *  - assertBeforeDeadline: server-UTC-clock-based deadline guard (R8a)
 *  - getGameweekState: returns the transfer deadline for a gameweek (R8a.3)
 *  - activateChip: chip activation with all guards (R8.1, R8.6–R8.9)
 *  - saveFreeHitSnapshot / restoreFreeHitSquad: Free Hit squad isolation (R8.5)
 *  - finalizeGameweek: auto-substitution + captain multiplier transfer (R9)
 */

import { FantasyRepository, AppError, buildChipStateKey } from '@fantasy/shared';
import type { SquadSlot, ChipType, Gameweek, GameweekStatus, RosterConfig } from '@fantasy/shared';
import { autoSubstitute } from './auto-substitute.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GameweekState {
  gameweek: number;
  transferDeadline: string;
  status: GameweekStatus;
}

export interface ChipActivationInput {
  fantasyTeamId: string;
  chipType: ChipType;
  gameweek: number;
}

// ─── DynamoDB Item Shapes ───────────────────────────────────────────────────

interface CompetitionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  competitionId: string;
  chips: ChipType[];
  rosterConfig: RosterConfig;
  schedule: { gameweeks: Gameweek[] };
  status: string;
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
  penaltyPoints?: number;
}

interface ChipStateItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  chipType: ChipType;
  gameweek: number;
  activatedAt: string;
  remainingUses: number;
}

interface FreeHitSnapshotItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  gameweek: number;
  squad: SquadSlot[];
  formation: string;
  budget: number;
  userId: string;
  competitionId: string;
  leagueId: string;
}

interface PlayerMatchStatsItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  playerId: string;
  fixtureId: string;
  minutesPlayed: number;
  stats: Record<string, number>;
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

// ─── Service ────────────────────────────────────────────────────────────────

export class GameweekService {
  constructor(private readonly repo: FantasyRepository) {}

  // ─── Deadline Guard (R8a) ─────────────────────────────────────────────

  /**
   * Assert that the server's current UTC time is before the gameweek's
   * transfer deadline. Throws TRANSFER_DEADLINE_PASSED if at or after.
   *
   * This is the sole authoritative time check (R8a.4).
   */
  async assertBeforeDeadline(competitionId: string, gameweek: number): Promise<void> {
    const competition = await this.getCompetition(competitionId);
    const gw = this.findGameweek(competition, gameweek);

    const now = Date.now();
    const deadline = new Date(gw.transferDeadline).getTime();

    if (now >= deadline) {
      throw new AppError(
        'TRANSFER_DEADLINE_PASSED',
        `The transfer deadline for gameweek ${gameweek} has passed`,
      );
    }
  }

  // ─── Gameweek State (R8a.3) ───────────────────────────────────────────

  /**
   * Returns the gameweek state including the UTC transfer deadline.
   */
  async getGameweekState(competitionId: string, gameweek: number): Promise<GameweekState> {
    const competition = await this.getCompetition(competitionId);
    const gw = this.findGameweek(competition, gameweek);

    return {
      gameweek: gw.gameweek,
      transferDeadline: gw.transferDeadline,
      status: gw.status,
    };
  }

  // ─── Chip Activation (R8.1, R8.6–R8.9) ───────────────────────────────

  /**
   * Activate a chip for the current gameweek.
   *
   * Guards (checked in this order):
   *  1. Chip is configured for the competition → CHIP_NOT_CONFIGURED
   *  2. Remaining uses > 0 → CHIP_UNAVAILABLE
   *  3. No other chip is active for the gameweek → CHIP_ALREADY_ACTIVE
   *  4. Before the deadline → TRANSFER_DEADLINE_PASSED
   *
   * On success: records chip active, decrements remaining uses.
   */
  async activateChip(userId: string, input: ChipActivationInput): Promise<void> {
    const { fantasyTeamId, chipType, gameweek } = input;

    // Fetch the team to resolve competitionId
    const team = await this.getFantasyTeam(userId, fantasyTeamId);
    const competition = await this.getCompetition(team.competitionId);

    // 1. Check chip is configured for the competition
    if (!competition.chips.includes(chipType)) {
      throw new AppError(
        'CHIP_NOT_CONFIGURED',
        `Chip ${chipType} is not configured for this competition`,
      );
    }

    // 2. Check remaining uses
    const chipKey = buildChipStateKey(fantasyTeamId, chipType);
    const chipState = await this.repo.get<ChipStateItem>(chipKey.PK, chipKey.SK);

    // If no chip state record exists, the chip has its default 1 use available
    const remainingUses = chipState ? chipState.remainingUses : 1;

    if (remainingUses <= 0) {
      throw new AppError('CHIP_UNAVAILABLE', `Chip ${chipType} has no remaining uses`);
    }

    // 3. Check no other chip is active for this gameweek
    const allChipTypes: ChipType[] = ['WILDCARD', 'TRIPLE_CAPTAIN', 'BENCH_BOOST', 'FREE_HIT'];
    for (const ct of allChipTypes) {
      if (ct === chipType) continue;
      const otherKey = buildChipStateKey(fantasyTeamId, ct);
      const otherChip = await this.repo.get<ChipStateItem>(otherKey.PK, otherKey.SK);
      if (otherChip && otherChip.gameweek === gameweek) {
        throw new AppError(
          'CHIP_ALREADY_ACTIVE',
          `Another chip (${ct}) is already active for gameweek ${gameweek}`,
        );
      }
    }

    // 4. Deadline check (server UTC clock)
    const gw = this.findGameweek(competition, gameweek);
    const now = Date.now();
    const deadline = new Date(gw.transferDeadline).getTime();

    if (now >= deadline) {
      throw new AppError(
        'TRANSFER_DEADLINE_PASSED',
        `The transfer deadline for gameweek ${gameweek} has passed`,
      );
    }

    // All guards pass — record chip as active and decrement uses
    const updatedChipState: ChipStateItem = {
      ...chipKey,
      fantasyTeamId,
      chipType,
      gameweek,
      activatedAt: new Date().toISOString(),
      remainingUses: remainingUses - 1,
    };

    await this.repo.put(updatedChipState);

    // If Free Hit, save a snapshot of the current squad before changes
    if (chipType === 'FREE_HIT') {
      await this.saveFreeHitSnapshot(fantasyTeamId, gameweek, team);
    }
  }

  // ─── Free Hit Snapshot (R8.5) ─────────────────────────────────────────

  /**
   * Save the current squad as the Free Hit snapshot so it can be restored
   * at the start of the next gameweek.
   */
  private async saveFreeHitSnapshot(
    fantasyTeamId: string,
    gameweek: number,
    team: FantasyTeamItem,
  ): Promise<void> {
    const snapshot: FreeHitSnapshotItem = {
      PK: `TEAM#${fantasyTeamId}`,
      SK: `FREEHIT_SNAPSHOT#${String(gameweek).padStart(3, '0')}`,
      fantasyTeamId,
      gameweek,
      squad: team.squad,
      formation: team.formation,
      budget: team.budget,
      userId: team.userId,
      competitionId: team.competitionId,
      leagueId: team.leagueId,
    };

    await this.repo.put(snapshot);
  }

  /**
   * Restore the squad from the Free Hit snapshot.
   * Called at the start of the next gameweek to roll back
   * any squad changes made under the Free Hit chip.
   */
  async restoreFreeHitSquad(fantasyTeamId: string, gameweek: number): Promise<void> {
    const snapshotSK = `FREEHIT_SNAPSHOT#${String(gameweek).padStart(3, '0')}`;
    const snapshot = await this.repo.get<FreeHitSnapshotItem>(`TEAM#${fantasyTeamId}`, snapshotSK);

    if (!snapshot) {
      // No Free Hit was used for this gameweek — nothing to restore
      return;
    }

    // Update the team record with the restored squad, formation, and budget
    const teamPK = `USER#${snapshot.userId}`;
    const teamSK = `TEAM#${snapshot.competitionId}#${snapshot.leagueId}`;

    await this.repo.update(
      teamPK,
      teamSK,
      'SET #squad = :squad, #formation = :formation, #budget = :budget',
      { '#squad': 'squad', '#formation': 'formation', '#budget': 'budget' },
      { ':squad': snapshot.squad, ':formation': snapshot.formation, ':budget': snapshot.budget },
    );

    // Clean up the snapshot after successful restoration
    await this.repo.delete(snapshot.PK, snapshot.SK);
  }

  // ─── Finalization: Auto-Substitution (R9) ─────────────────────────────

  /**
   * Finalize a gameweek: perform auto-substitution for inactive starters
   * and transfer captain multiplier when applicable.
   *
   * Algorithm:
   *  1. For each fantasy team in the competition for this gameweek:
   *     a. Identify starters with 0 minutes (in ascending lineup order)
   *     b. For each inactive starter, find the highest-priority bench player
   *        with ≥1 minute that preserves position constraints
   *     c. Swap them (one substitution at a time, re-evaluating after each)
   *  2. Captain multiplier transfer:
   *     - If captain played 0 min and vice-captain played ≥1 min → vice gets multiplier
   *     - If both played 0 min → no multiplier applied
   *  3. Restore Free Hit squads for the completed gameweek
   */
  async finalizeGameweek(competitionId: string, gameweek: number): Promise<void> {
    const competition = await this.getCompetition(competitionId);

    // Query all fantasy teams in this competition via GSI2
    let allTeams: FantasyTeamItem[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await this.repo.query<FantasyTeamItem>({
        indexName: 'GSI2',
        keyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :skPrefix)',
        expressionAttributeValues: {
          ':pk': `COMP#${competitionId}`,
          ':skPrefix': 'USER#',
        },
        exclusiveStartKey: lastEvaluatedKey,
      });

      allTeams = allTeams.concat(result.items);
      lastEvaluatedKey = result.lastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Process each team
    for (const team of allTeams) {
      await this.processTeamFinalization(team, competition, gameweek);
    }

    // Restore any Free Hit squads from this gameweek
    for (const team of allTeams) {
      await this.restoreFreeHitSquad(team.fantasyTeamId, gameweek);
    }
  }

  // ─── Private: Team Finalization ───────────────────────────────────────

  private async processTeamFinalization(
    team: FantasyTeamItem,
    competition: CompetitionItem,
    gameweek: number,
  ): Promise<void> {
    // Fetch player match stats for this gameweek
    const playerMinutes = await this.getPlayerMinutes(competition.competitionId, gameweek);
    const rosterConfig = competition.rosterConfig;

    // Get player positions for constraint checking
    const playerPositions = await this.getPlayerPositions(competition.competitionId, team.squad);

    // Delegate to the pure auto-substitution function (no I/O)
    const result = autoSubstitute({
      squad: team.squad,
      matchStats: playerMinutes,
      playerPositions,
      rosterConfig,
    });

    // Persist the updated squad
    await this.repo.update(
      team.PK,
      team.SK,
      'SET #squad = :squad',
      { '#squad': 'squad' },
      { ':squad': result.squad },
    );
  }

  // ─── Private: Player Minutes Lookup ───────────────────────────────────

  /**
   * Fetch minutes played for all players in a competition's gameweek.
   * Returns a map of playerId → minutesPlayed.
   */
  private async getPlayerMinutes(
    competitionId: string,
    gameweek: number,
  ): Promise<Map<string, number>> {
    const gw = String(gameweek).padStart(3, '0');
    const minutesMap = new Map<string, number>();

    // Query match stats for the gameweek
    // Stats are stored with PK = COMPETITION#<compId>, SK = STATS#<gw>#<playerId>
    const result = await this.repo.query<PlayerMatchStatsItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `COMPETITION#${competitionId}`,
        ':skPrefix': `STATS#${gw}#`,
      },
    });

    for (const item of result.items) {
      const existing = minutesMap.get(item.playerId) ?? 0;
      minutesMap.set(item.playerId, existing + item.minutesPlayed);
    }

    // Fallback: try the GSI-based approach if direct query returned nothing
    if (minutesMap.size === 0) {
      const gsiResult = await this.repo.query<PlayerMatchStatsItem>({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: {
          ':pk': `COMP_GW_STATS#${competitionId}#${gw}`,
        },
      });

      for (const item of gsiResult.items) {
        const existing = minutesMap.get(item.playerId) ?? 0;
        minutesMap.set(item.playerId, existing + item.minutesPlayed);
      }
    }

    return minutesMap;
  }

  // ─── Private: Player Positions Lookup ─────────────────────────────────

  /**
   * Get positions for all players in a squad from the player records.
   */
  private async getPlayerPositions(
    competitionId: string,
    squad: SquadSlot[],
  ): Promise<Map<string, string>> {
    const positionMap = new Map<string, string>();

    const players = await Promise.all(
      squad.map((s) =>
        this.repo.get<PlayerItem>(`COMPETITION#${competitionId}`, `PLAYER#${s.playerId}`),
      ),
    );

    for (const player of players) {
      if (player) {
        positionMap.set(player.playerId, player.position);
      }
    }

    return positionMap;
  }

  // ─── Private: Competition & Team Lookup ───────────────────────────────

  private async getCompetition(competitionId: string): Promise<CompetitionItem> {
    const competition = await this.repo.get<CompetitionItem>(
      `COMPETITION#${competitionId}`,
      'META',
    );

    if (!competition) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    return competition;
  }

  private findGameweek(competition: CompetitionItem, gameweek: number): Gameweek {
    const gw = competition.schedule.gameweeks.find((g) => g.gameweek === gameweek);

    if (!gw) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Gameweek ${gameweek} not found in competition schedule`,
      );
    }

    return gw;
  }

  private async getFantasyTeam(userId: string, fantasyTeamId: string): Promise<FantasyTeamItem> {
    const result = await this.repo.query<FantasyTeamItem>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      filterExpression: 'fantasyTeamId = :teamId',
      expressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TEAM#',
        ':teamId': fantasyTeamId,
      },
    });

    const team = result.items[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', `Fantasy team ${fantasyTeamId} not found`);
    }

    return team;
  }
}
