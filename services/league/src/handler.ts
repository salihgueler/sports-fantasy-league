/**
 * League Service Lambda handler.
 * Routes:
 *   POST /leagues — create a new league
 *   POST /leagues/join-by-code — join a league via its 8-char code
 *   POST /leagues/:leagueId/join — join a public league by ID
 *   POST /leagues/:leagueId/h2h-schedule — generate round-robin H2H schedule
 *   GET  /leagues/:leagueId/standings — get league standings
 *   POST /leagues/:leagueId/chat — post a chat message
 *   GET  /leagues/:leagueId/chat — get chat history
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createHandler,
  FantasyRepository,
  AppError,
  CreateLeagueSchema,
  JoinByCodeSchema,
} from '@fantasy/shared';
import type { CreateLeagueInput, JoinByCodeInput } from '@fantasy/shared';
import { LeagueService } from './league-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

const repo = new FantasyRepository({ tableName });
const service = new LeagueService(repo);

// ─── Route Handlers ─────────────────────────────────────────────────────────

const createLeagueHandler = createHandler<CreateLeagueInput>({
  requireAuth: true,
  schema: CreateLeagueSchema,
  handler: async ({ body, user }) => {
    const league = await service.createLeague(user!.userId, body);
    return { league };
  },
});

const listPublicLeaguesHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const competitionId = event.queryStringParameters?.competitionId;
    if (!competitionId) {
      throw new AppError('VALIDATION_ERROR', 'competitionId query parameter is required');
    }
    const leagues = await service.listPublicLeagues(competitionId);
    return { leagues };
  },
});

const listMyLeaguesHandler = createHandler({
  requireAuth: true,
  handler: async ({ user }) => {
    const leagues = await service.listMyLeagues(user!.userId);
    return { leagues };
  },
});

const deleteLeagueHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const leagueId = event.pathParameters?.leagueId;
    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }
    await service.deleteLeague(user!.userId, leagueId);
    return { message: 'League deleted' };
  },
});

const generateH2HScheduleHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const leagueId = event.pathParameters?.leagueId;

    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }

    const fixtures = await service.generateH2HSchedule(leagueId);
    return { fixtures };
  },
});

const joinByCodeHandler = createHandler<JoinByCodeInput>({
  requireAuth: true,
  schema: JoinByCodeSchema,
  handler: async ({ user, body }) => {
    await service.joinByCode(user!.userId, body.joinCode);
    return { message: 'Successfully joined the league' };
  },
});

const joinPublicHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const leagueId = event.pathParameters?.leagueId;

    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }

    await service.joinPublic(user!.userId, leagueId);
    return { message: 'Successfully joined the league' };
  },
});

const getStandingsHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const leagueId = event.pathParameters?.leagueId;

    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }

    const standings = await service.getStandings(leagueId);
    return { standings };
  },
});

const postChatMessageHandler = createHandler({
  requireAuth: true,
  handler: async ({ event, user }) => {
    const leagueId = event.pathParameters?.leagueId;

    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }

    let rawBody: { body?: string } = {};
    try {
      rawBody = event.body ? JSON.parse(event.body) : {};
    } catch {
      throw new AppError('MALFORMED_REQUEST_BODY', 'Request body is not valid JSON');
    }

    if (typeof rawBody.body !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'body field is required and must be a string');
    }

    const message = await service.postMessage(user!.userId, leagueId, rawBody.body);
    return { message };
  },
});

const getChatHistoryHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const leagueId = event.pathParameters?.leagueId;

    if (!leagueId) {
      throw new AppError('VALIDATION_ERROR', 'leagueId path parameter is required');
    }

    const pageToken = event.queryStringParameters?.pageToken;
    const result = await service.getChatHistory(leagueId, pageToken);
    return result;
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  // POST /leagues
  if (method === 'POST' && path === '/leagues') {
    return createLeagueHandler(event);
  }

  // GET /leagues (leagues the user belongs to)
  if (method === 'GET' && path === '/leagues') {
    return listMyLeaguesHandler(event);
  }

  // POST /leagues/join-by-code
  if (method === 'POST' && path === '/leagues/join-by-code') {
    return joinByCodeHandler(event);
  }

  // GET /leagues/public?competitionId=...
  if (method === 'GET' && path === '/leagues/public') {
    return listPublicLeaguesHandler(event);
  }

  // POST /leagues/:leagueId/join
  if (method === 'POST' && path.startsWith('/leagues/') && path.endsWith('/join')) {
    const segments = path.split('/');
    const leagueId = segments[2];
    event.pathParameters = { ...event.pathParameters, leagueId };
    return joinPublicHandler(event);
  }

  // POST /leagues/:leagueId/h2h-schedule
  if (method === 'POST' && path.startsWith('/leagues/') && path.endsWith('/h2h-schedule')) {
    const segments = path.split('/');
    const leagueId = segments[2];
    event.pathParameters = { ...event.pathParameters, leagueId };
    return generateH2HScheduleHandler(event);
  }

  // GET /leagues/:leagueId/standings
  if (method === 'GET' && path.startsWith('/leagues/') && path.endsWith('/standings')) {
    const segments = path.split('/');
    const leagueId = segments[2];
    event.pathParameters = { ...event.pathParameters, leagueId };
    return getStandingsHandler(event);
  }

  // POST /leagues/:leagueId/chat
  if (method === 'POST' && path.startsWith('/leagues/') && path.endsWith('/chat')) {
    const segments = path.split('/');
    const leagueId = segments[2];
    event.pathParameters = { ...event.pathParameters, leagueId };
    return postChatMessageHandler(event);
  }

  // GET /leagues/:leagueId/chat
  if (method === 'GET' && path.startsWith('/leagues/') && path.endsWith('/chat')) {
    const segments = path.split('/');
    const leagueId = segments[2];
    event.pathParameters = { ...event.pathParameters, leagueId };
    return getChatHistoryHandler(event);
  }

  // DELETE /leagues/:leagueId
  if (method === 'DELETE' && path.startsWith('/leagues/') && path.split('/').length === 3) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, leagueId: segments[2] };
    return deleteLeagueHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}
