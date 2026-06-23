import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface WebSocketStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
}

/**
 * WebSocket API stack for the Multi-Sport Fantasy League platform.
 *
 * Provisions:
 * - API Gateway WebSocket API with route selection expression `$request.body.action`
 * - $connect route with a Lambda authorizer that verifies JWTs (R11.2, R11.3)
 * - $disconnect route that removes connection items from DynamoDB
 * - $default route placeholder for subscription management
 * - Connection items stored in DynamoDB with TTL for automatic cleanup
 */
export class WebSocketStack extends cdk.NestedStack {
  public readonly webSocketApi: apigwv2.WebSocketApi;
  public readonly webSocketStage: apigwv2.WebSocketStage;
  public readonly connectFn: lambdaNode.NodejsFunction;
  public readonly disconnectFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    const servicesRoot = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'services',
      'realtime',
      'src',
    );

    // ─── $connect Lambda ──────────────────────────────────────────────────────

    this.connectFn = new lambdaNode.NodejsFunction(this, 'ConnectFn', {
      functionName: `FantasyWsConnect-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(servicesRoot, 'connect-handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: props.table.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    props.table.grantWriteData(this.connectFn);

    // ─── $disconnect Lambda ───────────────────────────────────────────────────

    this.disconnectFn = new lambdaNode.NodejsFunction(this, 'DisconnectFn', {
      functionName: `FantasyWsDisconnect-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(servicesRoot, 'disconnect-handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: props.table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    props.table.grantWriteData(this.disconnectFn);

    // ─── WebSocket API ────────────────────────────────────────────────────────

    // The $connect route uses the connectFn as both the authorizer and integration.
    // The connectFn validates the JWT and stores the connection — acting as a
    // request-level authorizer by returning 401 on invalid tokens.
    this.webSocketApi = new apigwv2.WebSocketApi(this, 'FantasyWebSocketApi', {
      apiName: `FantasyWebSocket-${props.stageName}`,
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          this.connectFn,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          this.disconnectFn,
        ),
      },
    });

    // ─── WebSocket Stage ──────────────────────────────────────────────────────

    this.webSocketStage = new apigwv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: this.webSocketApi,
      stageName: props.stageName,
      autoDeploy: true,
    });

    // Grant the Lambdas permissions to manage WebSocket connections
    const manageConnectionsPolicy = new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.apiId}/${props.stageName}/*`,
      ],
    });
    this.connectFn.addToRolePolicy(manageConnectionsPolicy);
    this.disconnectFn.addToRolePolicy(manageConnectionsPolicy);

    // ─── Outputs ──────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: this.webSocketStage.url,
      description: 'WebSocket API endpoint URL',
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApi.apiId,
      description: 'WebSocket API ID',
    });
  }
}
