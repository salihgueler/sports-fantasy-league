/**
 * WebSocket subscribe route handler.
 *
 * Manages competition subscriptions per connection:
 * - `subscribe`: adds a subscription (capped at 50 per connection, R11.6)
 * - `onReconnect`: restores prior subscriptions from the user's subscription
 *   record when a client reconnects (R11.5)
 *
 * Implements: R11.5 (restore subs within 2s), R11.6 (<=50 cap)
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SUBSCRIPTIONS_PER_CONNECTION = 50;
const SUBSCRIPTION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// ─── Environment ────────────────────────────────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

// ─── Clients ────────────────────────────────────────────────────────────────

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebSocketDefaultEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
  };
  body?: string | null;
}

interface SubscribeAction {
  action: 'subscribe';
  competitionId: string;
}

// ─── Subscribe Logic ────────────────────────────────────────────────────────

/**
 * Subscribe a connection to a competition.
 * Enforces a per-connection cap of 50 subscriptions (R11.6).
 */
async function subscribe(
  connectionId: string,
  competitionId: string,
): Promise<APIGatewayProxyResultV2> {
  // Count existing subscriptions for this connection
  const countResult = await ddbClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `CONN#${connectionId}`,
        ':skPrefix': 'SUB#',
      },
      Select: 'COUNT',
    }),
  );

  const currentCount = countResult.Count ?? 0;

  if (currentCount >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
    console.warn('Subscription limit exceeded', { connectionId, currentCount });
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        message: `Maximum of ${MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions per connection exceeded`,
      }),
    };
  }

  // Persist subscription item with GSI for fan-out lookups
  const ttl = Math.floor(Date.now() / 1000) + SUBSCRIPTION_TTL_SECONDS;

  await ddbClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `CONN#${connectionId}`,
        SK: `SUB#${competitionId}`,
        GSI1PK: `COMP_SUB#${competitionId}`,
        GSI1SK: `CONN#${connectionId}`,
        competitionId,
        subscribedAt: new Date().toISOString(),
        ttl,
      },
    }),
  );

  // Also persist a user-level subscription record for reconnect restoration
  // Retrieve the userId from the connection META item
  const connResult = await ddbClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `CONN#${connectionId}`,
        SK: 'META',
      },
      ProjectionExpression: 'userId',
    }),
  );

  const userId = connResult.Item?.userId;
  if (userId) {
    await ddbClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `USER_SUBS#${userId}`,
          SK: `COMP#${competitionId}`,
          competitionId,
          updatedAt: new Date().toISOString(),
          ttl,
        },
      }),
    );
  }

  console.info('Subscription added', { connectionId, competitionId });
  return {
    statusCode: 200,
    body: JSON.stringify({ action: 'subscribed', competitionId }),
  };
}

// ─── Reconnect Logic ────────────────────────────────────────────────────────

/**
 * Restore prior subscriptions for a reconnecting user (R11.5).
 * Looks up the user's stored subscriptions and re-creates them for the new connection.
 * Must complete within 2 seconds of reconnection.
 */
export async function onReconnect(
  connectionId: string,
  userId: string,
): Promise<void> {
  // Query all stored user subscriptions
  const subsResult = await ddbClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER_SUBS#${userId}`,
        ':skPrefix': 'COMP#',
      },
    }),
  );

  const items = subsResult.Items ?? [];
  if (items.length === 0) {
    console.info('No prior subscriptions to restore', { connectionId, userId });
    return;
  }

  // Restore subscriptions (up to the cap) using batch writes
  const ttl = Math.floor(Date.now() / 1000) + SUBSCRIPTION_TTL_SECONDS;
  const subsToRestore = items.slice(0, MAX_SUBSCRIPTIONS_PER_CONNECTION);

  // DynamoDB BatchWrite supports up to 25 items per call
  const batchSize = 25;
  for (let i = 0; i < subsToRestore.length; i += batchSize) {
    const batch = subsToRestore.slice(i, i + batchSize);
    const putRequests = batch.map((item) => ({
      PutRequest: {
        Item: {
          PK: `CONN#${connectionId}`,
          SK: `SUB#${item.competitionId}`,
          GSI1PK: `COMP_SUB#${item.competitionId}`,
          GSI1SK: `CONN#${connectionId}`,
          competitionId: item.competitionId,
          subscribedAt: new Date().toISOString(),
          ttl,
        },
      },
    }));

    await ddbClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName!]: putRequests,
        },
      }),
    );
  }

  console.info('Subscriptions restored on reconnect', {
    connectionId,
    userId,
    count: subsToRestore.length,
  });
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Lambda handler for the WebSocket $default route `subscribe` action.
 */
export async function handler(event: WebSocketDefaultEvent): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'MALFORMED_REQUEST', message: 'Missing message body' }) };
  }

  let parsed: SubscribeAction;
  try {
    parsed = JSON.parse(event.body) as SubscribeAction;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'MALFORMED_REQUEST', message: 'Invalid JSON' }) };
  }

  if (parsed.action !== 'subscribe') {
    return { statusCode: 400, body: JSON.stringify({ error: 'UNKNOWN_ACTION', message: `Unknown action: ${parsed.action}` }) };
  }

  if (!parsed.competitionId || typeof parsed.competitionId !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'VALIDATION_ERROR', message: 'competitionId is required' }),
    };
  }

  return subscribe(connectionId, parsed.competitionId);
}
