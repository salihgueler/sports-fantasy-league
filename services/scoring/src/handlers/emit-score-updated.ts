/**
 * EmitScoreUpdated — publish a ScoreUpdated event after a scoring run.
 *
 * The EventBridge `ScoreUpdated` rule routes this to the realtime fan-out Lambda
 * so connected clients refresh their scores.
 *
 * Requirements: 11.4
 */

import type { Handler } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

interface EmitScoreUpdatedEvent {
  mode?: string;
  results?: unknown;
}

export interface EmitScoreUpdatedResult {
  published: boolean;
}

const eventBusName = process.env.EVENT_BUS_NAME ?? 'default';

export const handler: Handler<EmitScoreUpdatedEvent, EmitScoreUpdatedResult> = async (event) => {
  const client = new EventBridgeClient({});

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'fantasy.scoring',
          DetailType: 'ScoreUpdated',
          EventBusName: eventBusName,
          Detail: JSON.stringify({
            mode: event.mode === 'reconcile' ? 'reconcile' : 'live',
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  return { published: true };
};
