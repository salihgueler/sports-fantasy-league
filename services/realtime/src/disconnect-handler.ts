/**
 * WebSocket $disconnect route handler.
 *
 * Deletes the connection item from DynamoDB when a client disconnects.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

// ─── Environment ────────────────────────────────────────────────────────────

const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('Missing required environment variable: TABLE_NAME');
}

// ─── Clients ────────────────────────────────────────────────────────────────

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Handler ────────────────────────────────────────────────────────────────

export interface WebSocketDisconnectEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
    eventType: string;
  };
}

export async function handler(event: WebSocketDisconnectEvent): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;

  await ddbClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: `CONN#${connectionId}`,
        SK: 'META',
      },
    }),
  );

  console.info('Connection removed', { connectionId });
  return { statusCode: 200, body: 'Disconnected' };
}
