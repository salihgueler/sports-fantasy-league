/**
 * Transfer Service — processes player transfers with penalty logic and guards.
 *
 * submitTransfer: replaces outgoing players with incoming players, decrements
 * free transfers, applies penalties beyond the free allowance, and respects
 * Wildcard/Free Hit chip state.
 *
 * Guards:
 *  - TRANSFER_DEADLINE_PASSED — after the gameweek deadline
 *  - BUDGET_EXCEEDED — incoming cost exceeds freed budget
 *  - PLAYER_ALREADY_IN_SQUAD — incoming player already in squad
 */

import {
  FantasyRepository,
  AppError,
  buildFantasyTeamKey,
  buildChipStateKey,
} from '@fantasy/shared';
import type {
  SquadSlot,
  Competition,
  TransferRules,
  Gameweek,
  ChipType,
  Player,
} from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TransferInput {
  fantasyTeamId: string;
  playersIn: string[];
  playersOut: string[];
}

export interface TransferResult {
  transfersMade: number;
  penaltyPoints: number;
  freeTransfersRemaining: number;
}

// ─── DynamoDB Item Shapes ───────────────────────────────────────────────────

interface CompetitionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  competitionId: string;
  transferRules: TransferRules;
  schedule: { gameweeks: Gameweek[] };
  rosterConfig: { budget: number };
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

interface TransferRecordItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fantasyTeamId: string;
  gameweek: number;
  playerIn: string;
  playerOut: string;
  timestamp: string;
  penaltyApplied: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class TransferService {
  constructor(private readonly repo: FantasyRepository) {}

  /**
   * Submit a transfer: replace outgoing players with incoming players.
   *
   * Flow:
   *  1. Fetch fantasy team
   *  2. Fetch competition (transferRules, schedule, budget)
   *  3. Determine current gameweek and check deadline
   *  4. Check Wildcard/Free Hit chip state
   *  5. Validate incoming/outgoing players
   *  6. Budget check
   *  7. Apply transfer: swap players in squad
   *  8. If not Wildcard/Free Hit: decrement free transfers, compute penalty
   *  9. Persist updated team and transfer records
   * 10. Return result
   */
  async submitTransfer(userId: string, input: TransferInput): Promise<TransferResult> {
    const { fantasyTeamId, playersIn, playersOut } = input;

    // 1. Fetch the fantasy team
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

    // 2. Fetch competition
    const competition = await this.repo.get<CompetitionItem>(
      `COMPETITION#${team.competitionId}`,
      'META',
    );

    if (!competition) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${team.competitionId} not found`);
    }

    const transferRules = competition.transferRules;
    const gameweeks = competition.schedule.gameweeks;

    // 3. Determine current gameweek and check deadline
    const now = new Date();
    const currentGameweek = this.getCurrentGameweek(gameweeks, now);

    if (!currentGameweek) {
      throw new AppError('TRANSFER_DEADLINE_PASSED', 'No active gameweek found for transfers');
    }

    const deadline = new Date(currentGameweek.transferDeadline);
    if (now >= deadline) {
      throw new AppError(
        'TRANSFER_DEADLINE_PASSED',
        'The transfer deadline for this gameweek has passed',
      );
    }

    // 4. Check Wildcard/Free Hit chip state
    const isChipActive = await this.isWildcardOrFreeHitActive(
      fantasyTeamId,
      currentGameweek.gameweek,
    );

    // 5. Validate incoming/outgoing players
    const currentSquadPlayerIds = new Set(team.squad.map((s) => s.playerId));

    // Verify outgoing players are in the squad
    for (const playerOut of playersOut) {
      if (!currentSquadPlayerIds.has(playerOut)) {
        throw new AppError('INVALID_TRANSFER', `Player ${playerOut} is not in your squad`);
      }
    }

    // Verify incoming players are NOT in the squad
    for (const playerIn of playersIn) {
      if (currentSquadPlayerIds.has(playerIn)) {
        throw new AppError(
          'PLAYER_ALREADY_IN_SQUAD',
          `Player ${playerIn} is already in your squad`,
        );
      }
    }

    // Fetch player details for budget calculation
    const outgoingPlayers = await Promise.all(
      playersOut.map((playerId) =>
        this.repo.get<PlayerItem>(`COMPETITION#${team.competitionId}`, `PLAYER#${playerId}`),
      ),
    );

    const incomingPlayers = await Promise.all(
      playersIn.map((playerId) =>
        this.repo.get<PlayerItem>(`COMPETITION#${team.competitionId}`, `PLAYER#${playerId}`),
      ),
    );

    // Verify incoming players exist in the competition
    for (let i = 0; i < incomingPlayers.length; i++) {
      if (!incomingPlayers[i]) {
        throw new AppError('INVALID_TRANSFER', `Player ${playersIn[i]} not found in competition`);
      }
    }

    // 6. Budget check
    const outgoingCost = outgoingPlayers.reduce((sum, p) => sum + (p?.price ?? 0), 0);
    const incomingCost = incomingPlayers.reduce((sum, p) => sum + (p!.price ?? 0), 0);

    const budgetAfterTransfer = team.budget + outgoingCost - incomingCost;

    if (budgetAfterTransfer < 0) {
      throw new AppError(
        'BUDGET_EXCEEDED',
        'The incoming players cost more than the freed budget allows',
      );
    }

    // 7. Apply transfer: swap players in squad
    let updatedSquad = [...team.squad];
    for (let i = 0; i < playersOut.length; i++) {
      const outId = playersOut[i];
      const inId = playersIn[i];
      const slotIndex = updatedSquad.findIndex((s) => s.playerId === outId);
      if (slotIndex !== -1) {
        updatedSquad[slotIndex] = {
          ...updatedSquad[slotIndex],
          playerId: inId,
          isCaptain: false,
          isViceCaptain: false,
        };
      }
    }

    // 8. Compute penalty and update free transfers
    const transferCount = playersIn.length;
    let penaltyPoints = 0;
    let freeTransfersRemaining = team.freeTransfers;

    if (!isChipActive) {
      // Decrement free transfers and apply penalty for extras
      for (let i = 0; i < transferCount; i++) {
        if (freeTransfersRemaining > 0) {
          freeTransfersRemaining--;
        } else {
          penaltyPoints += transferRules.penaltyPointsPerExtra;
        }
      }
    }
    // If Wildcard/Free Hit active: no penalty, no decrement

    // 9. Persist updated team
    const keys = buildFantasyTeamKey({
      userId,
      compId: team.competitionId,
      leagueId: team.leagueId,
      totalPoints: team.totalPoints,
    });

    const updatedTeamItem: FantasyTeamItem = {
      ...keys,
      fantasyTeamId: team.fantasyTeamId,
      userId,
      leagueId: team.leagueId,
      competitionId: team.competitionId,
      name: team.name,
      squad: updatedSquad,
      formation: team.formation,
      budget: budgetAfterTransfer,
      freeTransfers: freeTransfersRemaining,
      totalPoints: team.totalPoints,
      penaltyPoints: (team.penaltyPoints ?? 0) + penaltyPoints,
    };

    await this.repo.put(updatedTeamItem);

    // Persist transfer records with timestamps
    const timestamp = now.toISOString();
    const transferRecords: TransferRecordItem[] = playersIn.map((playerIn, idx) => ({
      PK: `TEAM#${fantasyTeamId}`,
      SK: `TRANSFER#${currentGameweek.gameweek}#${timestamp}#${idx}`,
      fantasyTeamId,
      gameweek: currentGameweek.gameweek,
      playerIn,
      playerOut: playersOut[idx],
      timestamp,
      penaltyApplied:
        !isChipActive && idx >= team.freeTransfers ? transferRules.penaltyPointsPerExtra : 0,
    }));

    await Promise.all(transferRecords.map((record) => this.repo.put(record)));

    // 10. Return result
    return {
      transfersMade: transferCount,
      penaltyPoints,
      freeTransfersRemaining,
    };
  }

  /**
   * Grant gameweek free transfers to all fantasy teams in a competition.
   *
   * Formula: newFreeTransfers = min(freeTransfersPerGameweek + unusedCarriedOver, carryOverLimit)
   *
   * Where:
   *  - freeTransfersPerGameweek: from competition's TransferRules (default 1)
   *  - unusedCarriedOver: team's current freeTransfers (what they didn't use last GW)
   *  - carryOverLimit: from competition's TransferRules (default 2)
   *
   * Called by the orchestration layer at the start of each gameweek.
   */
  async grantGameweekTransfers(competitionId: string): Promise<{ teamsUpdated: number }> {
    // 1. Fetch competition for TransferRules
    const competition = await this.repo.get<CompetitionItem>(
      `COMPETITION#${competitionId}`,
      'META',
    );

    if (!competition) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    const { freeTransfersPerGameweek, carryOverLimit } = competition.transferRules;

    // 2. Query all fantasy teams in this competition via GSI2 (COMP#<compId>)
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

    // 3. For each team: compute new free transfers and persist
    let teamsUpdated = 0;

    for (const team of allTeams) {
      const unusedCarriedOver = team.freeTransfers;
      const newFreeTransfers = Math.min(
        freeTransfersPerGameweek + unusedCarriedOver,
        carryOverLimit,
      );

      // Update the team's freeTransfers in place
      const keys = buildFantasyTeamKey({
        userId: team.userId,
        compId: team.competitionId,
        leagueId: team.leagueId,
        totalPoints: team.totalPoints,
      });

      await this.repo.update(
        keys.PK,
        keys.SK,
        'SET #ft = :newFt',
        { '#ft': 'freeTransfers' },
        { ':newFt': newFreeTransfers },
      );

      teamsUpdated++;
    }

    return { teamsUpdated };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Determine the current gameweek: the first upcoming/live gameweek whose
   * deadline has not yet passed, or the last one before the current time.
   */
  private getCurrentGameweek(gameweeks: Gameweek[], now: Date): Gameweek | null {
    // Sort by gameweek number ascending
    const sorted = [...gameweeks].sort((a, b) => a.gameweek - b.gameweek);

    // Find the gameweek whose deadline is still in the future (or the latest one)
    for (const gw of sorted) {
      if (gw.status === 'upcoming' || gw.status === 'live') {
        return gw;
      }
    }

    // Fallback: return the last non-finalized gameweek
    const nonFinalized = sorted.filter((gw) => gw.status !== 'finalized');
    return nonFinalized.length > 0 ? nonFinalized[nonFinalized.length - 1] : null;
  }

  /**
   * Check if a Wildcard or Free Hit chip is active for the given
   * fantasy team and gameweek.
   */
  private async isWildcardOrFreeHitActive(
    fantasyTeamId: string,
    gameweek: number,
  ): Promise<boolean> {
    const chipTypes: ChipType[] = ['WILDCARD', 'FREE_HIT'];

    const checks = await Promise.all(
      chipTypes.map(async (chipType) => {
        const key = buildChipStateKey(fantasyTeamId, chipType);
        const item = await this.repo.get<ChipStateItem>(key.PK, key.SK);
        return item && item.gameweek === gameweek;
      }),
    );

    return checks.some((active) => active === true);
  }
}
