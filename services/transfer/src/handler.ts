/**
 * Transfer Service Lambda handler.
 * Routes:
 *   POST /transfers — submit a transfer
 *   POST /competitions/:competitionId/grant-transfers — grant gameweek free transfers (admin)
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHandler, FantasyRepository, AppError, SubmitTransferSchema } from '@fantasy/shared';
import type { SubmitTransferInput } from '@fantasy/shared';
import { TransferService } from './transfer-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

const repo = new FantasyRepository({ tableName });
const service = new TransferService(repo);

// ─── Route Handlers ─────────────────────────────────────────────────────────

const submitTransferHandler = createHandler<SubmitTransferInput>({
  requireAuth: true,
  schema: SubmitTransferSchema,
  handler: async ({ user, body }) => {
    const result = await service.submitTransfer(user!.userId, {
      fantasyTeamId: body.fantasyTeamId,
      playersIn: body.playersIn,
      playersOut: body.playersOut,
    });

    return result;
  },
});

const grantTransfersHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const competitionId = event.pathParameters?.competitionId;

    if (!competitionId) {
      throw new AppError('VALIDATION_ERROR', 'competitionId path parameter is required');
    }

    const result = await service.grantGameweekTransfers(competitionId);
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

  // POST /transfers
  if (method === 'POST' && path === '/transfers') {
    return submitTransferHandler(event);
  }

  // POST /competitions/:competitionId/grant-transfers
  if (method === 'POST' && path.startsWith('/competitions/') && path.endsWith('/grant-transfers')) {
    const segments = path.split('/');
    const competitionId = segments[2];
    event.pathParameters = { ...event.pathParameters, competitionId };
    return grantTransfersHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}
