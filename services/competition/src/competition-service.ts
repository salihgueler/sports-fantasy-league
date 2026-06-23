/**
 * Competition Service — read and write operations.
 *
 * list: default returns upcoming/active by start asc; filter.status=completed returns
 *       completed by end desc. Max 100 results.
 * getById: returns full competition or throws COMPETITION_NOT_FOUND.
 * create: validates referential integrity and persists with status draft.
 */

import { randomUUID } from 'node:crypto';
import {
  FantasyRepository,
  AppError,
  buildCompetitionKey,
  buildScoringRulesetKey,
  buildAdapterKey,
} from '@fantasy/shared';
import type { Competition } from '@fantasy/shared';
import type { CreateCompetitionInput } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompetitionListFilter {
  status?: 'completed';
}

// ─── DynamoDB Item Shape ────────────────────────────────────────────────────

interface CompetitionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  competitionId: string;
  sport: string;
  name: string;
  format: string;
  scoringRulesetId: string;
  rosterConfig: Competition['rosterConfig'];
  transferRules: Competition['transferRules'];
  schedule: Competition['schedule'];
  chips: Competition['chips'];
  status: Competition['status'];
  dataProviderId: string;
  theme?: Competition['theme'];
}

interface FixtureItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  fixtureId: string;
  competitionId: string;
  gameweek: number;
  round?: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffTime: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
}

export interface FixtureSummary {
  fixtureId: string;
  competitionId: string;
  gameweek: number;
  round?: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffTime: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class CompetitionService {
  constructor(private readonly repo: FantasyRepository) {}

  /**
   * List competitions.
   * Default (no filter): returns upcoming and active competitions ordered by start asc.
   * filter.status === 'completed': returns completed competitions ordered by end desc.
   * Both limited to 100 results.
   */
  async list(filter?: CompetitionListFilter): Promise<Competition[]> {
    if (filter?.status === 'completed') {
      return this.listCompleted();
    }
    return this.listUpcomingAndActive();
  }

  /**
   * Get a single competition by ID. Throws COMPETITION_NOT_FOUND if not found.
   */
  async getById(competitionId: string): Promise<Competition> {
    const item = await this.repo.get<CompetitionItem>(`COMPETITION#${competitionId}`, 'META');

    if (!item) {
      throw new AppError('COMPETITION_NOT_FOUND', `Competition ${competitionId} not found`);
    }

    return this.toDomain(item);
  }

  /**
   * List all fixtures for a competition (scores + statuses are populated by the
   * daily sync), ordered by gameweek then kickoff time.
   */
  async getFixtures(competitionId: string): Promise<FixtureSummary[]> {
    const items: FixtureItem[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.repo.query<FixtureItem>({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        expressionAttributeValues: {
          ':pk': `COMPETITION#${competitionId}`,
          ':sk': 'FIXTURE#',
        },
        exclusiveStartKey: startKey,
      });
      items.push(...result.items);
      startKey = result.lastEvaluatedKey;
    } while (startKey);

    return items
      .map((item) => ({
        fixtureId: item.fixtureId,
        competitionId: item.competitionId,
        gameweek: item.gameweek,
        round: item.round,
        homeTeamId: item.homeTeamId,
        awayTeamId: item.awayTeamId,
        kickoffTime: item.kickoffTime,
        status: item.status,
        ...(typeof item.homeScore === 'number' ? { homeScore: item.homeScore } : {}),
        ...(typeof item.awayScore === 'number' ? { awayScore: item.awayScore } : {}),
      }))
      .sort((a, b) => a.gameweek - b.gameweek || a.kickoffTime.localeCompare(b.kickoffTime));
  }

  /**
   * Create a new competition with referential integrity validation.
   * Validates that referenced ScoringRuleset and DataProviderAdapter exist.
   * Persists with status `draft`.
   */
  async create(input: CreateCompetitionInput): Promise<Competition> {
    const invalidFields: Record<string, string> = {};

    // Validate referential integrity in parallel
    const rulesetKey = buildScoringRulesetKey(input.scoringRulesetId);
    const adapterKey = buildAdapterKey(input.dataProviderId);

    const [rulesetItem, adapterItem] = await Promise.all([
      this.repo.get<Record<string, unknown>>(rulesetKey.PK, rulesetKey.SK),
      this.repo.get<Record<string, unknown>>(adapterKey.PK, adapterKey.SK),
    ]);

    if (!rulesetItem) {
      invalidFields['scoringRulesetId'] =
        `ScoringRuleset '${input.scoringRulesetId}' does not exist`;
    }

    if (!adapterItem) {
      invalidFields['dataProviderId'] =
        `DataProviderAdapter '${input.dataProviderId}' does not exist`;
    }

    if (Object.keys(invalidFields).length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Referential integrity check failed', {
        fields: invalidFields,
      });
    }

    // Generate ID and persist
    const competitionId = randomUUID();
    const status = 'draft';
    const startTs = input.schedule.gameweeks[0]?.transferDeadline ?? new Date().toISOString();

    const keys = buildCompetitionKey({ compId: competitionId, status, startTs });

    const item: CompetitionItem = {
      ...keys,
      competitionId,
      sport: input.sport,
      name: input.name,
      format: input.format,
      scoringRulesetId: input.scoringRulesetId,
      rosterConfig: input.rosterConfig,
      transferRules: input.transferRules,
      schedule: input.schedule,
      chips: input.chips,
      status,
      dataProviderId: input.dataProviderId,
      ...(input.theme && { theme: input.theme }),
    };

    await this.repo.put(item);

    return this.toDomain(item);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private async listUpcomingAndActive(): Promise<Competition[]> {
    // Query GSI1 for upcoming and active, both sorted by start ascending
    const [upcomingResult, activeResult] = await Promise.all([
      this.repo.query<CompetitionItem>({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': 'COMP_STATUS#upcoming' },
        scanIndexForward: true,
        limit: 100,
      }),
      this.repo.query<CompetitionItem>({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': 'COMP_STATUS#active' },
        scanIndexForward: true,
        limit: 100,
      }),
    ]);

    // Merge and sort by start time ascending, then cap at 100
    const combined = [...upcomingResult.items, ...activeResult.items];
    combined.sort((a, b) => {
      const startA = a.GSI1SK ?? '';
      const startB = b.GSI1SK ?? '';
      return startA.localeCompare(startB);
    });

    return combined.slice(0, 100).map((item) => this.toDomain(item));
  }

  private async listCompleted(): Promise<Competition[]> {
    const result = await this.repo.query<CompetitionItem>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :pk',
      expressionAttributeValues: { ':pk': 'COMP_STATUS#completed' },
      scanIndexForward: false, // end desc (most recently ended first)
      limit: 100,
    });

    return result.items.map((item) => this.toDomain(item));
  }

  private toDomain(item: CompetitionItem): Competition {
    return {
      competitionId: item.competitionId,
      sport: item.sport as Competition['sport'],
      name: item.name,
      format: item.format as Competition['format'],
      scoringRulesetId: item.scoringRulesetId,
      rosterConfig: item.rosterConfig,
      transferRules: item.transferRules,
      schedule: item.schedule,
      chips: item.chips,
      status: item.status,
      dataProviderId: item.dataProviderId,
      ...(item.theme && { theme: item.theme }),
    };
  }
}
