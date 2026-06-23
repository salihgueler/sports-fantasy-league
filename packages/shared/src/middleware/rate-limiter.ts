/**
 * Per-user rate limiting middleware.
 *
 * Uses DynamoDB to track request counts within a 60-second rolling window.
 * Rejects with RATE_LIMIT_EXCEEDED when a user exceeds 100 requests in 60 seconds.
 *
 * Key schema:
 *   PK: RATELIMIT#<userId>
 *   SK: WINDOW#<windowStart>  (windowStart = floor(now / 60) * 60)
 *   TTL: windowStart + 120 (two windows to cover the rolling window)
 *
 * Uses atomic increment via UpdateCommand with ADD expression.
 */

import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { AppError } from './errors.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RateLimiterConfig {
  tableName: string;
  maxRequests?: number;
  windowSeconds?: number;
  clientConfig?: DynamoDBClientConfig;
}

const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_WINDOW_SECONDS = 60;

// ─── Rate Limiter Class ─────────────────────────────────────────────────────

export class RateLimiter {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly maxRequests: number;
  private readonly windowSeconds: number;

  constructor(config: RateLimiterConfig) {
    this.tableName = config.tableName;
    this.maxRequests = config.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.windowSeconds = config.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

    const client = new DynamoDBClient(config.clientConfig ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Check and increment the rate limit counter for a user.
   * Throws AppError('RATE_LIMIT_EXCEEDED') if the user has exceeded the limit.
   */
  async check(userId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / this.windowSeconds) * this.windowSeconds;
    const previousWindowStart = windowStart - this.windowSeconds;

    // Query both the current and previous window to approximate a rolling window
    const [currentCount, previousCount] = await Promise.all([
      this.incrementAndGetCount(userId, windowStart),
      this.getCount(userId, previousWindowStart),
    ]);

    // Calculate the weighted count for the rolling window:
    // Weight the previous window by the fraction of it that overlaps with "now - 60s"
    const elapsedInCurrentWindow = now - windowStart;
    const previousWindowWeight = 1 - elapsedInCurrentWindow / this.windowSeconds;
    const effectiveCount =
      Math.floor(previousCount * previousWindowWeight) + currentCount;

    if (effectiveCount > this.maxRequests) {
      throw new AppError(
        'RATE_LIMIT_EXCEEDED',
        `Rate limit exceeded: more than ${this.maxRequests} requests in ${this.windowSeconds} seconds`,
      );
    }
  }

  /**
   * Atomically increment the counter for the given window and return the new value.
   */
  private async incrementAndGetCount(
    userId: string,
    windowStart: number,
  ): Promise<number> {
    const pk = `RATELIMIT#${userId}`;
    const sk = `WINDOW#${windowStart}`;
    const ttl = windowStart + this.windowSeconds * 2;

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: 'ADD #count :inc SET #ttl = :ttl',
        ExpressionAttributeNames: {
          '#count': 'requestCount',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':ttl': ttl,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );

    return (result.Attributes?.requestCount as number) ?? 1;
  }

  /**
   * Get the count for a previous window (does not increment).
   */
  private async getCount(userId: string, windowStart: number): Promise<number> {
    const pk = `RATELIMIT#${userId}`;
    const sk = `WINDOW#${windowStart}`;

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': sk,
        },
        Limit: 1,
      }),
    );

    if (result.Items && result.Items.length > 0) {
      return (result.Items[0].requestCount as number) ?? 0;
    }
    return 0;
  }
}
