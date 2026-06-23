/**
 * Competition Service Lambda handler.
 * Routes: GET /competitions, GET /competitions/:competitionId, POST /competitions
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createHandler,
  FantasyRepository,
  AppError,
  CreateCompetitionSchema,
} from '@fantasy/shared';
import type { CreateCompetitionInput } from '@fantasy/shared';
import { CompetitionService } from './competition-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

const repo = new FantasyRepository({ tableName });
const service = new CompetitionService(repo);

// ─── Route Handlers ─────────────────────────────────────────────────────────

const listCompetitionsHandler = createHandler({
  requireAuth: false,
  handler: async ({ event }) => {
    const statusFilter = event.queryStringParameters?.status;

    const filter = statusFilter === 'completed' ? { status: 'completed' as const } : undefined;

    const competitions = await service.list(filter);
    return { competitions };
  },
});

const getCompetitionByIdHandler = createHandler({
  requireAuth: false,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;

    if (!competitionId) {
      throw new AppError('VALIDATION_ERROR', 'competitionId path parameter is required');
    }

    const competition = await service.getById(competitionId);
    return { competition };
  },
});

const getFixturesHandler = createHandler({
  requireAuth: false,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;

    if (!competitionId) {
      throw new AppError('VALIDATION_ERROR', 'competitionId path parameter is required');
    }

    const fixtures = await service.getFixtures(competitionId);
    return { fixtures };
  },
});

const createCompetitionHandler = createHandler<CreateCompetitionInput>({
  requireAuth: true,
  schema: CreateCompetitionSchema,
  handler: async ({ body }) => {
    const competition = await service.create(body);
    return { competition };
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  // GET /competitions
  if (method === 'GET' && path === '/competitions') {
    return listCompetitionsHandler(event);
  }

  // POST /competitions
  if (method === 'POST' && path === '/competitions') {
    return createCompetitionHandler(event);
  }

  // GET /competitions/:competitionId/fixtures
  if (method === 'GET' && path.startsWith('/competitions/') && path.endsWith('/fixtures')) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, competitionId: segments[2] };
    return getFixturesHandler(event);
  }

  // GET /competitions/:competitionId
  if (method === 'GET' && path.startsWith('/competitions/') && path.split('/').length === 3) {
    const segments = path.split('/');
    event.pathParameters = { ...event.pathParameters, competitionId: segments[2] };
    return getCompetitionByIdHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}
