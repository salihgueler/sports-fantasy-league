import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config/environments';
import { DynamoDbStack } from './dynamodb-stack';
import { AuthStack } from './auth-stack';
import { ApiStack } from './api-stack';
import { ApiIntegrationStack } from './api-integration-stack';
import { WebSocketStack } from './websocket-stack';
import { ScoringStateMachineStack } from './scoring-state-machine';
import { SyncStateMachineStack } from './sync-state-machine';
import { WorldCupDailySyncStack } from './worldcup-daily-sync';
import { EventBridgeStack } from './eventbridge-stack';
import { SqsStack } from './sqs-stack';
import { SecretsStack } from './secrets-stack';
import { CloudFrontStack } from './cloudfront-stack';

export interface RootStackProps extends cdk.StackProps {
  readonly stage: StageConfig;
}

/**
 * Root stack for the Multi-Sport Fantasy League platform.
 * Child stacks for DynamoDB, Cognito, API Gateway, Lambda services,
 * and CloudFront/WAF will be nested here in subsequent tasks.
 */
export class RootStack extends cdk.Stack {
  public readonly dynamoDb: DynamoDbStack;
  public readonly auth: AuthStack;
  public readonly api: ApiStack;
  public readonly apiIntegration: ApiIntegrationStack;
  public readonly webSocket: WebSocketStack;
  public readonly scoringStateMachine: ScoringStateMachineStack;
  public readonly syncStateMachine: SyncStateMachineStack;
  public readonly worldCupDailySync: WorldCupDailySyncStack;
  public readonly eventBridge: EventBridgeStack;
  public readonly sqs: SqsStack;
  public readonly secrets: SecretsStack;
  public readonly cloudFront: CloudFrontStack;

  constructor(scope: Construct, id: string, props: RootStackProps) {
    super(scope, id, props);

    this.dynamoDb = new DynamoDbStack(this, 'DynamoDb', {
      stageName: props.stage.stageName,
    });

    this.auth = new AuthStack(this, 'Auth', {
      stageName: props.stage.stageName,
    });

    this.api = new ApiStack(this, 'Api', {
      stageName: props.stage.stageName,
      userPool: this.auth.userPool,
      allowedOrigins: props.stage.allowedOrigins,
    });

    this.apiIntegration = new ApiIntegrationStack(this, 'ApiIntegration', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
      restApi: this.api.api,
      userPoolId: this.auth.userPool.userPoolId,
      userPoolClientId: this.auth.userPoolClient.userPoolClientId,
      allowedOrigins: this.api.allowedOrigins,
    });

    this.webSocket = new WebSocketStack(this, 'WebSocket', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
      userPool: this.auth.userPool,
      userPoolClient: this.auth.userPoolClient,
    });

    // EventBridge bus for scoring and real-time events
    const fantasyEventBus = new events.EventBus(this, 'FantasyEventBus', {
      eventBusName: `FantasyEventBus-${props.stage.stageName}`,
    });

    this.scoringStateMachine = new ScoringStateMachineStack(this, 'ScoringStateMachine', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
      eventBus: fantasyEventBus,
    });

    this.syncStateMachine = new SyncStateMachineStack(this, 'SyncStateMachine', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
      eventBusName: fantasyEventBus.eventBusName,
    });

    this.worldCupDailySync = new WorldCupDailySyncStack(this, 'WorldCupDailySync', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
    });

    // Let the API dispatcher trigger the World Cup sync on demand (manual "Sync scores" button)
    this.apiIntegration.dispatcher.addEnvironment(
      'WORLDCUP_SYNC_FN',
      this.worldCupDailySync.fn.functionName,
    );
    this.worldCupDailySync.fn.grantInvoke(this.apiIntegration.dispatcher);

    this.eventBridge = new EventBridgeStack(this, 'EventBridge', {
      stageName: props.stage.stageName,
      eventBus: fantasyEventBus,
      scoringStateMachine: this.scoringStateMachine.stateMachine,
      table: this.dynamoDb.table,
      webSocketApi: this.webSocket.webSocketApi,
      webSocketStageName: props.stage.stageName,
    });

    this.sqs = new SqsStack(this, 'Sqs', {
      stageName: props.stage.stageName,
      table: this.dynamoDb.table,
      eventBus: fantasyEventBus,
    });

    this.secrets = new SecretsStack(this, 'Secrets', {
      stageName: props.stage.stageName,
    });

    // Extract the API Gateway domain from the URL for CloudFront origin
    const apiDomain = `${this.api.api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    this.cloudFront = new CloudFrontStack(this, 'CloudFront', {
      stageName: props.stage.stageName,
      apiGatewayDomain: apiDomain,
      apiStageName: props.stage.stageName,
    });

    new cdk.CfnOutput(this, 'Stage', {
      value: props.stage.stageName,
      description: 'Deployment stage',
    });
  }
}
