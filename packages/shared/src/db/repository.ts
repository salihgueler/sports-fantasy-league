/**
 * Typed DynamoDB repository client for the FantasyTable single-table design.
 *
 * Accepts a table name at construction time — never hardcodes it.
 * Provides CRUD + conditional-write helpers for the state-preservation invariant.
 */

import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RepositoryConfig {
  tableName: string;
  clientConfig?: DynamoDBClientConfig;
}

export interface PaginatedResult<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ConditionalPutOptions {
  /** When true, the put only succeeds if the item does NOT already exist. */
  onlyIfNotExists?: boolean;
  /**
   * Custom condition expression. Mutually exclusive with onlyIfNotExists.
   * e.g. "attribute_not_exists(PK) OR scoreStatus <> :confirmed"
   */
  conditionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}

export interface ConditionalUpdateOptions {
  updateExpression: string;
  conditionExpression: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}

export interface QueryOptions {
  indexName?: "GSI1" | "GSI2";
  keyConditionExpression: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
  scanIndexForward?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
  filterExpression?: string;
}

// ─── Repository Class ───────────────────────────────────────────────────────

export class FantasyRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: RepositoryConfig) {
    this.tableName = config.tableName;
    const client = new DynamoDBClient(config.clientConfig ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  // ─── Put (unconditional) ────────────────────────────────────────────────

  async put<T extends Record<string, unknown>>(item: T): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  // ─── Conditional Put ────────────────────────────────────────────────────

  /**
   * Put an item with a condition expression.
   * Used for state-preservation: e.g. only write if the score is not already CONFIRMED.
   * Returns true if the write succeeded, false if the condition check failed.
   */
  async conditionalPut<T extends Record<string, unknown>>(
    item: T,
    options: ConditionalPutOptions
  ): Promise<boolean> {
    let conditionExpression: string | undefined;
    let expressionAttributeNames = options.expressionAttributeNames;
    let expressionAttributeValues = options.expressionAttributeValues;

    if (options.onlyIfNotExists) {
      conditionExpression = "attribute_not_exists(PK)";
    } else if (options.conditionExpression) {
      conditionExpression = options.conditionExpression;
    }

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
      return true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw err;
    }
  }

  // ─── Get ────────────────────────────────────────────────────────────────

  async get<T extends Record<string, unknown>>(
    pk: string,
    sk: string
  ): Promise<T | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
      })
    );
    return result.Item as T | undefined;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  async query<T extends Record<string, unknown>>(
    options: QueryOptions
  ): Promise<PaginatedResult<T>> {
    const input: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: options.indexName,
      KeyConditionExpression: options.keyConditionExpression,
      ExpressionAttributeNames: options.expressionAttributeNames,
      ExpressionAttributeValues: options.expressionAttributeValues,
      ScanIndexForward: options.scanIndexForward ?? true,
      Limit: options.limit,
      ExclusiveStartKey: options.exclusiveStartKey,
      FilterExpression: options.filterExpression,
    };

    const result = await this.docClient.send(new QueryCommand(input));

    return {
      items: (result.Items ?? []) as T[],
      lastEvaluatedKey: result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined,
    };
  }

  // ─── Update ─────────────────────────────────────────────────────────────

  async update(
    pk: string,
    sk: string,
    updateExpression: string,
    expressionAttributeNames?: Record<string, string>,
    expressionAttributeValues?: Record<string, unknown>
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }

  // ─── Conditional Update ─────────────────────────────────────────────────

  /**
   * Update with a condition expression for state-preservation invariant.
   * e.g. Only update scores if scoreStatus <> CONFIRMED.
   * Returns true if the update succeeded, false if the condition check failed.
   */
  async conditionalUpdate(
    pk: string,
    sk: string,
    options: ConditionalUpdateOptions
  ): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
          UpdateExpression: options.updateExpression,
          ConditionExpression: options.conditionExpression,
          ExpressionAttributeNames: options.expressionAttributeNames,
          ExpressionAttributeValues: options.expressionAttributeValues,
        })
      );
      return true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw err;
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  async delete(pk: string, sk: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
      })
    );
  }
}
