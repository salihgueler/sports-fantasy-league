import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface WorldCupDailySyncStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly competitionId?: string;
}

/**
 * Daily openfootball World Cup 2026 score sync.
 * A scheduled Lambda (06:00 UTC) that fetches worldcup.json and updates
 * fixtures, gameweek/competition status, and player goal points.
 */
export class WorldCupDailySyncStack extends cdk.NestedStack {
  public readonly fn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: WorldCupDailySyncStackProps) {
    super(scope, id, props);

    const entry = path.join(
      __dirname, '..', '..', '..', '..',
      'services', 'data-sync', 'src', 'handlers', 'worldcup-daily-handler.ts',
    );

    this.fn = new lambdaNode.NodejsFunction(this, 'WorldCupDailySyncFn', {
      functionName: `FantasyWorldCupDailySync-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: props.table.tableName,
        COMPETITION_ID: props.competitionId ?? 'world-cup-2026',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    props.table.grantReadWriteData(this.fn);

    new events.Rule(this, 'DailySchedule', {
      ruleName: `FantasyWorldCupDailySync-${props.stageName}`,
      description: 'Daily World Cup 2026 score sync from openfootball',
      schedule: events.Schedule.cron({ minute: '0', hour: '6' }),
      targets: [new targets.LambdaFunction(this.fn)],
    });

    new cdk.CfnOutput(this, 'WorldCupDailySyncFnName', {
      value: this.fn.functionName,
      description: 'World Cup daily sync Lambda name (invoke manually to backfill)',
    });
  }
}
