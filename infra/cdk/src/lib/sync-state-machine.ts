import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface SyncStateMachineStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly eventBusName: string;
}

/**
 * Data Sync Step Functions state machine stack.
 *
 * Orchestrates roster/fixture/price/live-score sync with exponential backoff
 * (handled in Lambda code) and all-or-nothing semantics, invoking the
 * competition's registered DataProviderAdapter.
 *
 * Two execution modes:
 * - Full sync: roster -> fixtures -> prices (sequential, all-or-nothing)
 * - Live sync: live scores only (iterates active fixtures)
 *
 * Input shape:
 * {
 *   competitionId: string;
 *   dataProviderId: string;
 *   mode: "full" | "live";
 *   gameweek?: number;
 *   fixtureIds?: string[];
 * }
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 16.4
 */
export class SyncStateMachineStack extends cdk.NestedStack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly syncRosterFn: lambdaNode.NodejsFunction;
  public readonly syncFixturesFn: lambdaNode.NodejsFunction;
  public readonly syncPricesFn: lambdaNode.NodejsFunction;
  public readonly syncLiveScoresFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: SyncStateMachineStackProps) {
    super(scope, id, props);

    const servicesRoot = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'services',
      'data-sync',
      'src',
    );

    const commonLambdaProps: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: props.table.tableName,
        EVENT_BUS_NAME: props.eventBusName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    };

    // ─── Lambda Functions ───────────────────────────────────────────────────

    this.syncRosterFn = new lambdaNode.NodejsFunction(this, 'SyncRosterFn', {
      ...commonLambdaProps,
      functionName: `FantasySyncRoster-${props.stageName}`,
      handler: 'handler',
      entry: path.join(servicesRoot, 'handlers', 'sync-roster-handler.ts'),
    });

    this.syncFixturesFn = new lambdaNode.NodejsFunction(this, 'SyncFixturesFn', {
      ...commonLambdaProps,
      functionName: `FantasySyncFixtures-${props.stageName}`,
      handler: 'handler',
      entry: path.join(servicesRoot, 'handlers', 'sync-fixtures-handler.ts'),
    });

    this.syncPricesFn = new lambdaNode.NodejsFunction(this, 'SyncPricesFn', {
      ...commonLambdaProps,
      functionName: `FantasySyncPrices-${props.stageName}`,
      handler: 'handler',
      entry: path.join(servicesRoot, 'handlers', 'sync-prices-handler.ts'),
    });

    this.syncLiveScoresFn = new lambdaNode.NodejsFunction(this, 'SyncLiveScoresFn', {
      ...commonLambdaProps,
      functionName: `FantasySyncLiveScores-${props.stageName}`,
      handler: 'handler',
      entry: path.join(servicesRoot, 'handlers', 'sync-live-scores-handler.ts'),
    });

    // Grant DynamoDB access
    props.table.grantReadWriteData(this.syncRosterFn);
    props.table.grantReadWriteData(this.syncFixturesFn);
    props.table.grantReadWriteData(this.syncPricesFn);
    props.table.grantReadWriteData(this.syncLiveScoresFn);

    // Grant EventBridge publish access to the live scores function
    this.syncLiveScoresFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:event-bus/${props.eventBusName}`,
        ],
      }),
    );

    // ─── State Machine Definition ────────────────────────────────────────────

    // Each state must belong to exactly one graph. Create separate instances
    // for each context that needs a failure/success terminal state.

    const failureParameters = {
      status: 'FAILED',
      'competitionId.$': '$.competitionId',
      'error.$': '$.error',
      'timestamp.$': '$$.State.EnteredTime',
    };

    const successParameters = {
      status: 'COMPLETED',
      'competitionId.$': '$.competitionId',
      'timestamp.$': '$$.State.EnteredTime',
    };

    // Failure states — one per graph context
    const recordFailureRoster = new sfn.Pass(this, 'RecordFailureRoster', {
      parameters: failureParameters,
    });

    const recordFailureFixtures = new sfn.Pass(this, 'RecordFailureFixtures', {
      parameters: failureParameters,
    });

    const recordFailurePrices = new sfn.Pass(this, 'RecordFailurePrices', {
      parameters: failureParameters,
    });

    const recordFailureMapItem = new sfn.Pass(this, 'RecordFailureMapItem', {
      parameters: failureParameters,
    });

    const recordFailureLiveSync = new sfn.Pass(this, 'RecordFailureLiveSync', {
      parameters: failureParameters,
    });

    const recordFailureDefault = new sfn.Pass(this, 'RecordFailureDefault', {
      parameters: failureParameters,
    });

    // Success states — one per branch
    const syncCompleteFullSync = new sfn.Pass(this, 'SyncCompleteFullSync', {
      parameters: successParameters,
    });

    const syncCompleteLiveSync = new sfn.Pass(this, 'SyncCompleteLiveSync', {
      parameters: successParameters,
    });

    // ─── Full Sync Branch (roster -> fixtures -> prices) ─────────────────────

    const syncRosterTask = new tasks.LambdaInvoke(this, 'SyncRoster', {
      lambdaFunction: this.syncRosterFn,
      payload: sfn.TaskInput.fromObject({
        'competitionId.$': '$.competitionId',
        'dataProviderId.$': '$.dataProviderId',
      }),
      resultPath: '$.rosterResult',
      retryOnServiceExceptions: true,
    });

    const syncFixturesTask = new tasks.LambdaInvoke(this, 'SyncFixtures', {
      lambdaFunction: this.syncFixturesFn,
      payload: sfn.TaskInput.fromObject({
        'competitionId.$': '$.competitionId',
        'dataProviderId.$': '$.dataProviderId',
      }),
      resultPath: '$.fixturesResult',
      retryOnServiceExceptions: true,
    });

    const syncPricesTask = new tasks.LambdaInvoke(this, 'SyncPrices', {
      lambdaFunction: this.syncPricesFn,
      payload: sfn.TaskInput.fromObject({
        'competitionId.$': '$.competitionId',
      }),
      resultPath: '$.pricesResult',
      retryOnServiceExceptions: true,
    });

    // Chain full sync: roster -> fixtures -> prices
    // On any step failure, route to its own RecordFailure (all-or-nothing semantics)
    syncRosterTask.addCatch(recordFailureRoster, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    syncFixturesTask.addCatch(recordFailureFixtures, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    syncPricesTask.addCatch(recordFailurePrices, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const fullSyncChain = syncRosterTask
      .next(syncFixturesTask)
      .next(syncPricesTask)
      .next(syncCompleteFullSync);

    // ─── Live Sync Branch (iterate fixtures for live scores) ─────────────────

    const syncLiveScoresTask = new tasks.LambdaInvoke(this, 'SyncLiveScoresForFixture', {
      lambdaFunction: this.syncLiveScoresFn,
      payload: sfn.TaskInput.fromObject({
        'competitionId.$': '$.competitionId',
        'dataProviderId.$': '$.dataProviderId',
        'fixtureId.$': '$.fixtureId',
        'gameweek.$': '$.gameweek',
      }),
      resultPath: '$.liveScoreResult',
      retryOnServiceExceptions: true,
    });

    // Catch inside the Map item processor graph
    syncLiveScoresTask.addCatch(recordFailureMapItem, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Map state iterates over fixtureIds for live sync
    const iterateFixtures = new sfn.Map(this, 'IterateFixtures', {
      itemsPath: '$.fixtureIds',
      parameters: {
        'competitionId.$': '$.competitionId',
        'dataProviderId.$': '$.dataProviderId',
        'gameweek.$': '$.gameweek',
        'fixtureId.$': '$$.Map.Item.Value',
      },
      maxConcurrency: 5,
      resultPath: '$.liveResults',
    });

    iterateFixtures.itemProcessor(syncLiveScoresTask);

    // Catch at the Map level (top-level live sync graph)
    iterateFixtures.addCatch(recordFailureLiveSync, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const liveSyncChain = iterateFixtures.next(syncCompleteLiveSync);

    // ─── Mode Choice ─────────────────────────────────────────────────────────

    const modeChoice = new sfn.Choice(this, 'CheckSyncMode')
      .when(sfn.Condition.stringEquals('$.mode', 'full'), fullSyncChain)
      .when(sfn.Condition.stringEquals('$.mode', 'live'), liveSyncChain)
      .otherwise(recordFailureDefault);

    // ─── State Machine ───────────────────────────────────────────────────────

    const logGroup = new logs.LogGroup(this, 'SyncStateMachineLog', {
      logGroupName: `/fantasy/sync-state-machine/${props.stageName}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.stateMachine = new sfn.StateMachine(this, 'DataSyncStateMachine', {
      stateMachineName: `FantasyDataSync-${props.stageName}`,
      definitionBody: sfn.DefinitionBody.fromChainable(modeChoice),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      },
    });

    // ─── Outputs ─────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'SyncStateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Data Sync State Machine ARN',
    });
  }
}
