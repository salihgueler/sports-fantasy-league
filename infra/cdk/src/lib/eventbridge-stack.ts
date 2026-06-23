import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface EventBridgeStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly eventBus: events.IEventBus;
  readonly scoringStateMachine: sfn.IStateMachine;
  readonly table: dynamodb.ITable;
  readonly webSocketApi: apigwv2.IWebSocketApi;
  readonly webSocketStageName: string;
}

/**
 * EventBridge scheduling and routing stack.
 *
 * Provisions:
 * - Scheduled rule "live" (every 5 minutes) → triggers the Scoring state machine with mode=live
 * - Scheduled rule "reconcile" (daily at 04:00 UTC) → triggers the Scoring state machine with mode=reconcile
 * - Event rule on FantasyEventBus: DetailType=ScoreUpdated → Realtime fan-out Lambda
 *
 * Requirements: 11.1, 11.4, 19.5
 */
export class EventBridgeStack extends cdk.NestedStack {
  public readonly fanoutFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: EventBridgeStackProps) {
    super(scope, id, props);

    const realtimeRoot = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'services',
      'realtime',
      'src',
    );

    // ─── EventBridge Scheduler: Live scoring (every 5 minutes) ────────────────

    const liveScheduleRule = new events.Rule(this, 'LiveScoringSchedule', {
      ruleName: `FantasyLiveScoring-${props.stageName}`,
      description: 'Triggers scoring pipeline every 5 minutes in live mode',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    liveScheduleRule.addTarget(
      new targets.SfnStateMachine(props.scoringStateMachine, {
        input: events.RuleTargetInput.fromObject({
          mode: 'live',
          source: 'eventbridge-scheduler',
        }),
      }),
    );

    // ─── EventBridge Scheduler: Reconcile scoring (daily at 04:00 UTC) ────────

    const reconcileScheduleRule = new events.Rule(this, 'ReconcileScoringSchedule', {
      ruleName: `FantasyReconcileScoring-${props.stageName}`,
      description: 'Triggers scoring pipeline daily at 04:00 UTC in reconcile mode',
      schedule: events.Schedule.cron({ hour: '4', minute: '0' }),
    });

    reconcileScheduleRule.addTarget(
      new targets.SfnStateMachine(props.scoringStateMachine, {
        input: events.RuleTargetInput.fromObject({
          mode: 'reconcile',
          source: 'eventbridge-scheduler',
        }),
      }),
    );

    // ─── Realtime Fan-out Lambda ──────────────────────────────────────────────

    const websocketEndpoint = `https://${props.webSocketApi.apiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com/${props.webSocketStageName}`;

    this.fanoutFn = new lambdaNode.NodejsFunction(this, 'FanoutFn', {
      functionName: `FantasyRealtimeFanout-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(realtimeRoot, 'fanout-handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        WEBSOCKET_ENDPOINT: websocketEndpoint,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant DynamoDB read access for subscription queries
    props.table.grantReadWriteData(this.fanoutFn);

    // Grant permission to post messages to WebSocket connections
    this.fanoutFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${props.webSocketApi.apiId}/${props.webSocketStageName}/*`,
        ],
      }),
    );

    // ─── EventBridge Rule: ScoreUpdated → Fan-out Lambda ──────────────────────

    new events.Rule(this, 'ScoreUpdatedRule', {
      ruleName: `FantasyScoreUpdatedRoute-${props.stageName}`,
      description: 'Routes ScoreUpdated events from the bus to the realtime fan-out Lambda',
      eventBus: props.eventBus,
      eventPattern: {
        detailType: ['ScoreUpdated'],
      },
      targets: [new targets.LambdaFunction(this.fanoutFn)],
    });

    // ─── Outputs ──────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'FanoutFunctionArn', {
      value: this.fanoutFn.functionArn,
      description: 'Realtime fan-out Lambda ARN',
    });

    new cdk.CfnOutput(this, 'LiveScheduleRuleArn', {
      value: liveScheduleRule.ruleArn,
      description: 'Live scoring schedule rule ARN',
    });

    new cdk.CfnOutput(this, 'ReconcileScheduleRuleArn', {
      value: reconcileScheduleRule.ruleArn,
      description: 'Reconcile scoring schedule rule ARN',
    });
  }
}
