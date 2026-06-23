/**
 * API Gateway Dispatcher Lambda.
 *
 * A single Lambda fronted by a catch-all proxy route on the REST API. It routes
 * incoming requests to the appropriate service handler based on the request path
 * PREFIX. Order matters: more specific patterns are checked before generic ones.
 *
 * Each service handler has the signature:
 *   (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
 *
 * Auth is self-enforced inside each service via the shared middleware JWT
 * verification — the proxy route itself uses authorizationType NONE.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler as authHandler } from '@fantasy/auth';
import { handler as competitionHandler } from '@fantasy/competition';
import { handler as draftHandler } from '@fantasy/draft';
import { handler as transferHandler } from '@fantasy/transfer';
import { handler as gameweekHandler } from '@fantasy/gameweek';
import { handler as leagueHandler } from '@fantasy/league';
import { handler as profileHandler } from '@fantasy/profile';
import { createHandler, AppError } from '@fantasy/shared';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * Build the standard 404 error envelope for unmatched routes.
 */
function notFound(): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      meta: { requestId: 'unknown', timestamp: new Date().toISOString() },
    }),
  };
}

const lambdaClient = new LambdaClient({});

/**
 * Manually triggers the World Cup daily score-sync Lambda (the same logic the
 * EventBridge schedule runs) and returns its result synchronously.
 *
 * NOTE: requireAuth is enforced, but there is no role system — any authenticated
 * user can trigger a global resync. Acceptable for now; gate by role for prod.
 */
const triggerWorldCupSyncHandler = createHandler({
  requireAuth: true,
  handler: async ({ event }) => {
    const fnName = process.env.WORLDCUP_SYNC_FN;
    if (!fnName) {
      throw new AppError('CONFIG_ERROR', 'World Cup sync function is not configured');
    }
    const competitionId = event.pathParameters?.competitionId ?? 'world-cup-2026';
    const res = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ competitionId })),
      }),
    );
    if (res.FunctionError) {
      const errBody = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '';
      throw new AppError('SYNC_FAILED', `Score sync failed: ${errBody || res.FunctionError}`);
    }
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '{}';
    return JSON.parse(payload) as Record<string, unknown>;
  },
});

/**
 * Main Lambda entry point — dispatches by path prefix to the owning service.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { path } = event;

  // ─── Auth ──────────────────────────────────────────────────────────────────
  if (path.startsWith('/auth/')) {
    return authHandler(event);
  }

  // ─── Profile ─────────────────────────────────────────────────────────────────
  if (path === '/profile' || path.startsWith('/profile/')) {
    return profileHandler(event);
  }

  // ─── Leagues ─────────────────────────────────────────────────────────────────
  if (path.startsWith('/leagues')) {
    return leagueHandler(event);
  }

  // ─── Gameweeks ───────────────────────────────────────────────────────────────
  if (path.startsWith('/gameweeks')) {
    return gameweekHandler(event);
  }

  // ─── Transfers ───────────────────────────────────────────────────────────────
  if (path === '/transfers') {
    return transferHandler(event);
  }

  // ─── Teams ───────────────────────────────────────────────────────────────────
  // /teams/:id/chips → gameweek; all others (auto-pick, captaincy, formation) → draft
  if (path === '/teams' || path.startsWith('/teams/')) {
    if (path.endsWith('/chips')) {
      return gameweekHandler(event);
    }
    return draftHandler(event);
  }

  // ─── Competitions ──────────────────────────────────────────────────────────────
  // /competitions/:id/players → draft; /competitions/:id/grant-transfers → transfer;
  // all others (list, get, create) → competition
  if (path.startsWith('/competitions')) {
    if (event.httpMethod === 'POST' && path.endsWith('/sync')) {
      const segments = path.split('/');
      event.pathParameters = { ...event.pathParameters, competitionId: segments[2] };
      return triggerWorldCupSyncHandler(event);
    }
    if (path.endsWith('/players')) {
      return draftHandler(event);
    }
    if (path.endsWith('/grant-transfers')) {
      return transferHandler(event);
    }
    return competitionHandler(event);
  }

  // ─── Fallback ────────────────────────────────────────────────────────────────
  return notFound();
}
