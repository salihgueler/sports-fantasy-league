/**
 * Gameweek Service Lambda handler.
 * Routes:
 *   GET    /gameweeks/:competitionId/:gameweek       — get gameweek state
 *   POST   /gameweeks/activate-chip                  — activate a chip
 *   POST   /teams/:fantasyTeamId/chips               — activate a chip (REST-style)
 *   POST   /gameweeks/:competitionId/:gameweek/finalize — finalize a gameweek (admin)
 *   POST   /gameweeks/assert-deadline                — assert before deadline (internal)
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHandler, FantasyRepository, AppError, ActivateChipSchema } from '@fantasy/shared';
import type { ActivateChipInput } from '@fantasy/shared';
import { GameweekService } from './gameweek-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

const repo = new FantasyRepository({ tableName });
const service = new GameweekService(repo);

// ─── Route Handlers ─────────────────────────────────────────────────────────

const getGameweekStateHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;
    const gameweekStr = event.pathParameters?.gameweek;

    if (!competitionId || !gameweekStr) {
      throw new AppError(
        'VALIDATION_ERROR',
        'competitionId and gameweek path parameters are required',
      );
    }

    const gameweek = parseInt(gameweekStr, 10);
    if (isNaN(gameweek) || gameweek < 1) {
      throw new AppError('VALIDATION_ERROR', 'gameweek must be a positive integer');
    }

    return service.getGameweekState(competitionId, gameweek);
  },
});

const activateChipHandler = createHandler<ActivateChipInput>({
  requireAuth: true,
  schema: ActivateChipSchema,
  handler: async ({ user, body }) => {
    await service.activateChip(user!.userId, {
      fantasyTeamId: body.fantasyTeamId,
      chipType: body.chipType,
      gameweek: body.gameweek,
    });

    return { activated: true, chipType: body.chipType, gameweek: body.gameweek };
  },
});

/**
 * POST /teams/:fantasyTeamId/chips — REST-style chip activation.
 * The fantasyTeamId comes from the path; chipType and gameweek from the body.
 */
const activateChipPathHandler = createHandler<ActivateChipInput>({
  requireAuth: true,
  schema: ActivateChipSchema,
  handler: async ({ user, body }) => {
    await service.activateChip(user!.userId, {
      fantasyTeamId: body.fantasyTeamId,
      chipType: body.chipType,
      gameweek: body.gameweek,
    });

    return { activated: true, chipType: body.chipType, gameweek: body.gameweek };
  },
});

const finalizeGameweekHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;
    const gameweekStr = event.pathParameters?.gameweek;

    if (!competitionId || !gameweekStr) {
      throw new AppError(
        'VALIDATION_ERROR',
        'competitionId and gameweek path parameters are required',
      );
    }

    const gameweek = parseInt(gameweekStr, 10);
    if (isNaN(gameweek) || gameweek < 1) {
      throw new AppError('VALIDATION_ERROR', 'gameweek must be a positive integer');
    }

    await service.finalizeGameweek(competitionId, gameweek);
    return { finalized: true, competitionId, gameweek };
  },
});

const assertDeadlineHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;
    const gameweekStr = event.pathParameters?.gameweek;

    if (!competitionId || !gameweekStr) {
      throw new AppError(
        'VALIDATION_ERROR',
        'competitionId and gameweek path parameters are required',
      );
    }

    const gameweek = parseInt(gameweekStr, 10);
    if (isNaN(gameweek) || gameweek < 1) {
      throw new AppError('VALIDATION_ERROR', 'gameweek must be a positive integer');
    }

    await service.assertBeforeDeadline(competitionId, gameweek);
    return { beforeDeadline: true };
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  // GET /gameweeks/:competitionId/:gameweek
  if (method === 'GET' && path.match(/^\/gameweeks\/[^/]+\/\d+$/)) {
    const segments = path.split('/');
    event.pathParameters = {
      ...event.pathParameters,
      competitionId: segments[2],
      gameweek: segments[3],
    };
    return getGameweekStateHandler(event);
  }

  // POST /gameweeks/activate-chip
  if (method === 'POST' && path === '/gameweeks/activate-chip') {
    return activateChipHandler(event);
  }

  // POST /teams/:fantasyTeamId/chips
  if (method === 'POST' && path.match(/^\/teams\/[^/]+\/chips$/)) {
    const segments = path.split('/');
    const fantasyTeamId = segments[2];
    // Inject fantasyTeamId from path into the body so schema validation covers it
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    event.body = JSON.stringify({ ...parsedBody, fantasyTeamId });
    return activateChipPathHandler(event);
  }

  // POST /gameweeks/:competitionId/:gameweek/finalize
  if (method === 'POST' && path.match(/^\/gameweeks\/[^/]+\/\d+\/finalize$/)) {
    const segments = path.split('/');
    event.pathParameters = {
      ...event.pathParameters,
      competitionId: segments[2],
      gameweek: segments[3],
    };
    return finalizeGameweekHandler(event);
  }

  // POST /gameweeks/:competitionId/:gameweek/assert-deadline
  if (method === 'POST' && path.match(/^\/gameweeks\/[^/]+\/\d+\/assert-deadline$/)) {
    const segments = path.split('/');
    event.pathParameters = {
      ...event.pathParameters,
      competitionId: segments[2],
      gameweek: segments[3],
    };
    return assertDeadlineHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}
