/**
 * ResolveTargets — first step of the scoring pipeline.
 *
 * The EventBridge schedule fires with only `{ mode }`, so this step expands that
 * into the concrete units of work: for every active competition it selects the
 * gameweeks to score (live gameweeks in 'live' mode, finalized gameweeks in
 * 'reconcile' mode) and the fixtures within them. The state machine then fans
 * out over the returned targets with a Map state.
 *
 * Requirements: 10.5, 10.6, 11.4
 */

import type { Handler } from 'aws-lambda';
import { getScoringRepository, normalizeMode, queryAll, type ScoringMode } from './util.js';

interface ResolveTargetsEvent {
  mode?: string;
  source?: string;
}

export interface ScoringTarget {
  competitionId: string;
  gameweek: number;
  fixtureIds: string[];
  dataProviderId: string;
}

export interface ResolveTargetsResult {
  mode: ScoringMode;
  targets: ScoringTarget[];
}

interface GameweekSchedule {
  gameweek: number;
  status: string;
  transferDeadline: string;
}

interface CompetitionItem extends Record<string, unknown> {
  competitionId: string;
  dataProviderId: string;
  schedule?: { gameweeks?: GameweekSchedule[] };
}

interface FixtureItem extends Record<string, unknown> {
  fixtureId: string;
  gameweek: number;
  status: string;
}

export const handler: Handler<ResolveTargetsEvent, ResolveTargetsResult> = async (event) => {
  const mode = normalizeMode(event.mode);
  const repo = getScoringRepository();

  // Active competitions (GSI1: COMP_STATUS#active).
  const competitions = await queryAll<CompetitionItem>(repo, {
    indexName: 'GSI1',
    keyConditionExpression: 'GSI1PK = :pk',
    expressionAttributeValues: { ':pk': 'COMP_STATUS#active' },
  });

  // Live mode scores in-progress gameweeks; reconcile confirms finished ones.
  const wantStatus = mode === 'reconcile' ? 'finalized' : 'live';

  const targets: ScoringTarget[] = [];

  for (const competition of competitions) {
    const gameweeks = (competition.schedule?.gameweeks ?? []).filter(
      (gw) => gw.status === wantStatus,
    );
    if (gameweeks.length === 0) {
      continue;
    }

    const fixtures = await queryAll<FixtureItem>(repo, {
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      expressionAttributeValues: {
        ':pk': `COMPETITION#${competition.competitionId}`,
        ':sk': 'FIXTURE#',
      },
    });

    for (const gw of gameweeks) {
      const fixtureIds = fixtures
        .filter((f) => f.gameweek === gw.gameweek)
        .map((f) => f.fixtureId);

      targets.push({
        competitionId: competition.competitionId,
        gameweek: gw.gameweek,
        fixtureIds,
        dataProviderId: competition.dataProviderId,
      });
    }
  }

  return { mode, targets };
};
