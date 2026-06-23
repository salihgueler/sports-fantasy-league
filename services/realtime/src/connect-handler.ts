/**
 * WebSocket $connect route handler.
 *
 * Validates the JWT from the `token` query string parameter using aws-jwt-verify.
 * On valid JWT: stores a connection item in DynamoDB with a 24-hour TTL.
 * On invalid/missing/expired JWT: returns 401 to reject the connection.
 *
 * Implements: R11.2 (register within 2s), R11.3 (reject invalid JWTs)
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { onReconnect } from './subscribe-handler.js';

// ─── Environment ────────────────────────────────────────────────────────────

const tableName = process.env.TABLE_NAME;
const userPoolId = process.env.USER_POOL_ID;
const clientId = process.env.USER_POOL_CLIENT_ID;

if (!tableName || !userPoolId || !clientId) {
  throw new Error(
    'Missing required environment variables: TABLE_NAME, USER_POOL_ID, USER_POOL_CLIENT_ID',
  );
}

// ─── Clients ────────────────────────────────────────────────────────────────

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const verifier = CognitoJwtVerifier.create({
  userPoolId,
  tokenUse: 'access',
  clientId,
});

// ─── Handler ────────────────────────────────────────────────────────────────

export interface WebSocketConnectEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
    eventType: string;
    connectedAt: number;
  };
  queryStringParameters?: Record<string, string | undefined> | null;
}

export async function handler(event: WebSocketConnectEvent): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;

  // R11.3 — reject if no token
  if (!token) {
    console.warn('Connection rejected: missing token', { connectionId });
    return { statusCode: 401, body: 'Unauthorized: missing token' };
  }

  // Verify JWT signature and expiration
  let userId: string;
  try {
    const payload = await verifier.verify(token);
    userId = payload.sub;
  } catch (err) {
    console.warn('Connection rejected: invalid or expired token', {
      connectionId,
      error: (err as Error).message,
    });
    return { statusCode: 401, body: 'Unauthorized: invalid or expired token' };
  }

  // R11.2 — store connection item with 24h TTL
  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  await ddbClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `CONN#${connectionId}`,
        SK: 'META',
        userId,
        connectedAt: new Date().toISOString(),
        ttl,
      },
    }),
  );

  console.info('Connection registered', { connectionId, userId });

  // R11.5 — restore prior subscriptions on reconnect
  try {
    await onReconnect(connectionId, userId);
  } catch (err) {
    // Non-fatal: log but don't fail the connection
    console.warn('Failed to restore subscriptions on reconnect', {
      connectionId,
      userId,
      error: (err as Error).message,
    });
  }

  return { statusCode: 200, body: 'Connected' };
}
