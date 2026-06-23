import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export interface DynamoDbStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
}

/**
 * DynamoDB single-table stack for the Multi-Sport Fantasy League platform.
 *
 * Defines `FantasyTable` with:
 * - On-demand (PAY_PER_REQUEST) billing
 * - PK/SK composite primary key
 * - GSI1 (GSI1PK/GSI1SK) projecting ALL attributes
 * - GSI2 (GSI2PK/GSI2SK) projecting ALL attributes
 * - Encryption at rest with AWS-managed KMS key
 * - Point-in-time recovery enabled
 * - TTL attribute `ttl` for ephemeral WebSocket connection items
 */
export class DynamoDbStack extends cdk.NestedStack {
  public readonly table: dynamodb.Table;
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(scope: Construct, id: string, props: DynamoDbStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "FantasyTable", {
      tableName: `FantasyTable-${props.stageName}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.tableName = this.table.tableName;
    this.tableArn = this.table.tableArn;

    new cdk.CfnOutput(this, "FantasyTableName", {
      value: this.table.tableName,
      description: "DynamoDB FantasyTable name",
    });

    new cdk.CfnOutput(this, "FantasyTableArn", {
      value: this.table.tableArn,
      description: "DynamoDB FantasyTable ARN",
    });
  }
}
