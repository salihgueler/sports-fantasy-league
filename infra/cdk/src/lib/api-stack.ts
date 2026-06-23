import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface ApiStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  readonly userPool: cognito.IUserPool;
  /**
   * List of allowed CORS origins. Must not use wildcard in production.
   * Sourced from deployment configuration (e.g. cdk.json context or environment).
   */
  readonly allowedOrigins?: string[];
}

/**
 * API Gateway REST API stack for the Multi-Sport Fantasy League platform.
 *
 * Provisions:
 * - REST API with a Cognito User Pool authorizer (JWT validation via R18.2)
 * - Deployed to a stage matching the environment name
 * - Default throttling settings as placeholders for per-user throttling (R18.4)
 *   Per-user rate limiting (100 req / 60s) is enforced at the Lambda level.
 * - CORS restricted to configured allowed origins (R18.6)
 */
export class ApiStack extends cdk.NestedStack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  public readonly allowedOrigins: string[];

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Resolve allowed origins — never use wildcard; fall back to localhost for dev
    this.allowedOrigins =
      props.allowedOrigins && props.allowedOrigins.length > 0
        ? props.allowedOrigins
        : [`https://${props.stageName}.fantasy-league.example.com`];

    this.api = new apigateway.RestApi(this, 'FantasyApi', {
      restApiName: `FantasyApi-${props.stageName}`,
      description: 'Multi-Sport Fantasy League REST API',
      deployOptions: {
        stageName: props.stageName,
        throttlingBurstLimit: 200,
        throttlingRateLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: this.allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        maxAge: cdk.Duration.days(1),
      },
    });

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: `FantasyAuthorizer-${props.stageName}`,
      identitySource: 'method.request.header.Authorization',
    });

    // Health check endpoint — also ensures the authorizer is attached to the API
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod(
      'GET',
      new apigateway.MockIntegration({
        integrationResponses: [
          { statusCode: '200', responseTemplates: { 'application/json': '{"status":"ok"}' } },
        ],
        requestTemplates: { 'application/json': '{"statusCode": 200}' },
      }),
      {
        methodResponses: [{ statusCode: '200' }],
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      },
    );

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
    });

    new cdk.CfnOutput(this, 'AllowedOrigins', {
      value: this.allowedOrigins.join(','),
      description: 'Configured CORS allowed origins',
    });
  }
}
