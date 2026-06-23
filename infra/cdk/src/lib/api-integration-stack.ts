import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface ApiIntegrationStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly restApi: apigateway.IRestApi;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly allowedOrigins: string[];
}

/**
 * API Integration stack for the Multi-Sport Fantasy League platform.
 *
 * Provisions:
 * - An avatar S3 bucket (private, SSE-S3, SSL-enforced, retained)
 * - The single dispatcher NodejsFunction that routes all REST API requests to
 *   the per-domain service handlers (auth, competition, draft, transfer,
 *   gameweek, league, profile)
 * - A catch-all proxy route on the existing REST API wired to the dispatcher
 *
 * The proxy route uses authorizationType NONE — the dispatcher's services
 * self-enforce auth via shared-middleware JWT verification.
 */
export class ApiIntegrationStack extends cdk.NestedStack {
  public readonly dispatcher: lambdaNode.NodejsFunction;
  public readonly avatarBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ApiIntegrationStackProps) {
    super(scope, id, props);

    // ─── Avatar bucket ───────────────────────────────────────────────────────
    this.avatarBucket = new s3.Bucket(this, 'AvatarBucket', {
      bucketName: `fantasy-avatars-${props.stageName}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Dispatcher Lambda ─────────────────────────────────────────────────────
    this.dispatcher = new lambdaNode.NodejsFunction(this, 'ApiDispatcher', {
      functionName: `FantasyApiDispatcher-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'services',
        'api-gateway',
        'src',
        'handler.ts',
      ),
      handler: 'handler',
      environment: {
        TABLE_NAME: props.table.tableName,
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        AVATAR_BUCKET: this.avatarBucket.bucketName,
        ALLOWED_ORIGINS: props.allowedOrigins.join(','),
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // ─── Grants ──────────────────────────────────────────────────────────────
    props.table.grantReadWriteData(this.dispatcher);
    this.avatarBucket.grantReadWrite(this.dispatcher);

    // The auth service exchanges credentials directly with Cognito.
    const userPoolArn = `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${props.userPoolId}`;
    this.dispatcher.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:InitiateAuth',
          'cognito-idp:SignUp',
          'cognito-idp:ConfirmSignUp',
          'cognito-idp:ResendConfirmationCode',
        ],
        resources: [userPoolArn],
      }),
    );

    // ─── Proxy route ───────────────────────────────────────────────────────────
    props.restApi.root.addProxy({
      anyMethod: true,
      defaultIntegration: new apigateway.LambdaIntegration(this.dispatcher),
      defaultCorsPreflightOptions: {
        allowOrigins: props.allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      },
    });

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AvatarBucketName', {
      value: this.avatarBucket.bucketName,
      description: 'Avatar S3 bucket name',
    });
  }
}
