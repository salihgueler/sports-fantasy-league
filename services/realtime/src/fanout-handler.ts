/**
 * Fan-out handler for realtime score updates and chat messages.
 *
 * Triggered by EventBridge when the Scoring Engine emits a ScoreUpdated event
 * or when a ChatMessage is posted. Queries subscriptions by competition (GSI1)
 * and pushes the payload only to subscribed WebSocket connections.
 *
 * Implements: R11.1 (score fan-out), R11.4 (freshness target), R14.1 (chat delivery)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

// ─── Environment ────────────────────────────────────────────────────────────

const tableName = process.env.TABLE_NAME;
const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT;

if (!tableName || !websocketEndpoint) {
  throw new Error(
    'Missing required environment variables: TABLE_NAME, WEBSOCKET_ENDPOINT',
  );
}

// ─── Clients ────────────────────────────────────────────────────────────────

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const apigw = new ApiGatewayManagementApiClient({ endpoint: websocketEndpoint });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FanOutEvent {
  type: 'ScoreUpdated' | 'ChatMessage';
  competitionId: string;
  payload: Record<string, unknown>;
}

interface SubscriptionItem {
  PK: string;
  SK: string;
  GSI1SK: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handler(event: FanOutEvent): Promise<void> {
  const { type, competitionId, payload } = event;

  console.info('Fan-out started', { type, competitionId });

  const message = JSON.stringify({ type, competitionId, payload });
  const messageBuffer = Buffer.from(message);

  // Query all subscribed connections for this competition via GSI1
  const connectionIds = await getSubscribedConnections(competitionId);

  console.info('Subscribers found', { competitionId, count: connectionIds.length });

  // Fan-out: send to all connections in parallel batches
  const staleConnections: string[] = [];

  const sendPromises = connectionIds.map(async (connectionId) => {
    try {
      await apigw.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: messageBuffer,
        }),
      );
    } catch (err) {
      if (err instanceof GoneException) {
        staleConnections.push(connectionId);
      } else {
        console.error('Failed to post to connection', { connectionId, error: (err as Error).message });
      }
    }
  });

  await Promise.all(sendPromises);

  // Clean up stale connections
  if (staleConnections.length > 0) {
    console.info('Cleaning stale connections', { count: staleConnections.length });
    await cleanupStaleConnections(staleConnections);
  }

  console.info('Fan-out complete', { type, competitionId, sent: connectionIds.length - staleConnections.length, stale: staleConnections.length });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Queries GSI1 with partition key `COMP_SUB#<compId>` to retrieve all
 * connection IDs subscribed to the given competition. Handles pagination.
 */
async function getSubscribedConnections(competitionId: string): Promise<string[]> {
  const connectionIds: string[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `COMP_SUB#${competitionId}`,
        },
        ProjectionExpression: 'PK, GSI1SK',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    if (result.Items) {
      for (const item of result.Items) {
        // GSI1SK is `CONN#<connectionId>`, extract the connectionId
        const gsi1sk = item.GSI1SK as string;
        if (gsi1sk) {
          const connId = gsi1sk.replace('CONN#', '');
          connectionIds.push(connId);
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return connectionIds;
}

/**
 * Removes stale connection and subscription items from DynamoDB.
 * On GoneException the connection is no longer valid, so we clean up.
 */
async function cleanupStaleConnections(connectionIds: string[]): Promise<void> {
  const deletePromises = connectionIds.map(async (connectionId) => {
    try {
      await ddbClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            PK: `CONN#${connectionId}`,
            SK: 'META',
          },
        }),
      );
    } catch (err) {
      console.error('Failed to clean up stale connection', {
        connectionId,
        error: (err as Error).message,
      });
    }
  });

  await Promise.all(deletePromises);
}
