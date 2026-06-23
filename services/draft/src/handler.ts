/**
 * Draft Service Lambda handler.
 * Routes:
 *   GET  /competitions/:competitionId/players
 *   POST /teams/:fantasyTeamId/auto-pick
 *   PUT  /teams/:fantasyTeamId/captaincy
 *   PUT  /teams/:fantasyTeamId/formation
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createHandler,
  FantasyRepository,
  AppError,
  SetCaptaincySchema,
  SetFormationSchema,
  CreateTeamSchema,
  UpdateSquadSchema,
  RenameTeamSchema,
} from '@fantasy/shared';
import type { CreateTeamInput, UpdateSquadInput, RenameTeamInput } from '@fantasy/shared';
import { DraftService } from './draft-service.js';
import type { PlayerFilters } from './draft-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

const repo = new FantasyRepository({ tableName });
const service = new DraftService(repo);

// ─── Route Handlers ─────────────────────────────────────────────────────────

const getPlayerPoolHandler = createHandler({
  requireAuth: false,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;

    if (!competitionId) {
      throw new AppError('VALIDATION_ERROR', 'competitionId path parameter is required');
    }

    const params = event.queryStringParameters ?? {};

    const filters: PlayerFilters = {
      ...(params.realTeamId && { realTeamId: params.realTeamId }),
      ...(params.position && { position: params.position }),
      ...(params.minPrice && { minPrice: Number(params.minPrice) }),
      ...(params.maxPrice && { maxPrice: Number(params.maxPrice) }),
      ...(params.minPoints && { minPoints: Number(params.minPoints) }),
      ...(params.maxPoints && { maxPoints: Number(params.maxPoints) }),
      ...(params.availability && { availability: params.availability }),
    };

    const players = await service.getPlayerPool(competitionId, filters);
    return { players };
  },
});

const autoPickHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;

    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }

    const fantasyTeam = await service.autoPick(user!.userId, fantasyTeamId);
    return { fantasyTeam };
  },
});

const setCaptaincyHandler = createHandler({
  requireAuth: true,
  schema: SetCaptaincySchema,
  handler: async ({ event, user, body }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;

    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }

    const userId = user!.userId;

    await service.setCaptaincy(userId, {
      fantasyTeamId,
      captainId: body.captainId,
      viceCaptainId: body.viceCaptainId,
    });

    return { message: 'Captaincy updated successfully' };
  },
});

const setFormationHandler = createHandler({
  requireAuth: true,
  schema: SetFormationSchema,
  handler: async ({ event, user, body }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;

    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }

    const userId = user!.userId;

    await service.setFormation(userId, {
      fantasyTeamId,
      formation: body.formation,
      squad: body.squad,
    });

    return { message: 'Formation saved successfully' };
  },
});

const getTeamHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;
    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }
    const fantasyTeam = await service.getTeamById(user!.userId, fantasyTeamId);
    return { fantasyTeam };
  },
});

const createTeamHandler = createHandler<CreateTeamInput>({
  requireAuth: true,
  schema: CreateTeamSchema,
  handler: async ({ user, body }) => {
    const fantasyTeam = await service.createTeam(user!.userId, body);
    return { fantasyTeam };
  },
});

const updateSquadHandler = createHandler<UpdateSquadInput>({
  requireAuth: true,
  schema: UpdateSquadSchema,
  handler: async ({ event, user, body }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;
    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }
    const result = await service.updateSquad(user!.userId, fantasyTeamId, body.squad);
    return result;
  },
});

const listTeamsHandler = createHandler({
  requireAuth: true,
  handler: async ({ user }) => {
    const teams = await service.listTeams(user!.userId);
    return { teams };
  },
});

const renameTeamHandler = createHandler<RenameTeamInput>({
  requireAuth: true,
  schema: RenameTeamSchema,
  handler: async ({ event, user, body }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;
    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }
    const fantasyTeam = await service.renameTeam(user!.userId, fantasyTeamId, body.name);
    return { fantasyTeam };
  },
});

const deleteTeamHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const fantasyTeamId = event.pathParameters?.fantasyTeamId;
    if (!fantasyTeamId) {
      throw new AppError('VALIDATION_ERROR', 'fantasyTeamId path parameter is required');
    }
    await service.deleteTeam(user!.userId, fantasyTeamId);
    return { message: 'Team deleted' };
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  // GET /competitions/:competitionId/players
  if (method === 'GET' && path.startsWith('/competitions/') && path.endsWith('/players')) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, competitionId: segments[2] };
    return getPlayerPoolHandler(event);
  }

  // GET /teams (list the authenticated user's teams)
  if (method === 'GET' && path === '/teams') {
    return listTeamsHandler(event);
  }

  // POST /teams
  if (method === 'POST' && path === '/teams') {
    return createTeamHandler(event);
  }

  // PUT /teams/:fantasyTeamId/squad
  if (method === 'PUT' && path.startsWith('/teams/') && path.endsWith('/squad')) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, fantasyTeamId: segments[2] };
    return updateSquadHandler(event);
  }

  // GET /teams/:fantasyTeamId
  if (method === 'GET' && path.startsWith('/teams/') && path.split('/').length === 3) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, fantasyTeamId: segments[2] };
    return getTeamHandler(event);
  }

  // POST /teams/:fantasyTeamId/auto-pick
  if (method === 'POST' && path.startsWith('/teams/') && path.endsWith('/auto-pick')) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, fantasyTeamId: segments[2] };
    return autoPickHandler(event);
  }

  // PUT /teams/:fantasyTeamId/captaincy
  if (method === 'PUT' && path.startsWith('/teams/') && path.endsWith('/captaincy')) {
    const segments = path.split('/');
    const fantasyTeamId = segments[2];
    event.pathParameters = { ...event.pathParameters, fantasyTeamId };
    return setCaptaincyHandler(event);
  }

  // PUT /teams/:fantasyTeamId/formation
  if (method === 'PUT' && path.startsWith('/teams/') && path.endsWith('/formation')) {
    const segments = path.split('/');
    const fantasyTeamId = segments[2];
    event.pathParameters = { ...event.pathParameters, fantasyTeamId };
    return setFormationHandler(event);
  }

  // PUT /teams/:fantasyTeamId (rename)
  if (method === 'PUT' && path.startsWith('/teams/') && path.split('/').length === 3) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, fantasyTeamId: segments[2] };
    return renameTeamHandler(event);
  }

  // DELETE /teams/:fantasyTeamId
  if (method === 'DELETE' && path.startsWith('/teams/') && path.split('/').length === 3) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, fantasyTeamId: segments[2] };
    return deleteTeamHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}
