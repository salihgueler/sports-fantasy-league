import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface SqsStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly eventBus: events.IEventBus;
}

/**
 * SQS spike buffer stack for scoring and sync workloads.
 *
 * During game-day traffic spikes (R19.3), scoring and sync work is enqueued
 * to this SQS queue and consumed by a Lambda at controlled concurrency
 * (reservedConcurrency = 10) so write paths stay within latency budgets.
 *
 * A dead-letter queue captures messages that fail processing after 3 attempts,
 * with a CloudWatch alarm that fires when any messages land in the DLQ.
 *
 * Requirements: 19.3
 */
export class SqsStack extends cdk.NestedStack {
  public readonly scoringQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly processorFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: SqsStackProps) {
    super(scope, id, props);

    // ─── Dead-Letter Queue ──────────────────────────────────────────────────
    this.deadLetterQueue = new sqs.Queue(this, 'FantasyScoringDLQ', {
      queueName: `FantasyScoringDLQ-${props.stageName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ─── Main Scoring Queue ─────────────────────────────────────────────────
    this.scoringQueue = new sqs.Queue(this, 'FantasyScoringQueue', {
      queueName: `FantasyScoringQueue-${props.stageName}`,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // ─── DLQ CloudWatch Alarm ───────────────────────────────────────────────
    const alarmTopic = new sns.Topic(this, 'DlqAlarmTopic', {
      topicName: `FantasyScoringDLQ-Alarm-${props.stageName}`,
    });

    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqDepthAlarm', {
      alarmName: `FantasyScoringDLQ-Depth-${props.stageName}`,
      alarmDescription: 'Alarm when messages appear in the scoring dead-letter queue',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ─── Queue Processor Lambda ─────────────────────────────────────────────
    const scoringRoot = path.join(__dirname, '..', '..', '..', '..', 'services', 'scoring', 'src');

    this.processorFn = new lambdaNode.NodejsFunction(this, 'SqsProcessorFn', {
      functionName: `FantasySqsProcessor-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      reservedConcurrentExecutions: 10,
      handler: 'handler',
      entry: path.join(scoringRoot, 'sqs-processor.ts'),
      environment: {
        TABLE_NAME: props.table.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    props.table.grantReadWriteData(this.processorFn);
    props.eventBus.grantPutEventsTo(this.processorFn);

    // ─── Event Source Mapping ────────────────────────────────────────────────
    this.processorFn.addEventSource(
      new lambdaEventSources.SqsEventSource(this.scoringQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );

    // ─── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ScoringQueueUrl', {
      value: this.scoringQueue.queueUrl,
      description: 'Scoring spike buffer SQS queue URL',
    });

    new cdk.CfnOutput(this, 'ScoringQueueArn', {
      value: this.scoringQueue.queueArn,
      description: 'Scoring spike buffer SQS queue ARN',
    });

    new cdk.CfnOutput(this, 'DlqUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'Scoring dead-letter queue URL',
    });

    new cdk.CfnOutput(this, 'DlqAlarmArn', {
      value: dlqAlarm.alarmArn,
      description: 'DLQ depth CloudWatch alarm ARN',
    });
  }
}
