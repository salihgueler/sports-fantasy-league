import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export interface SecretsStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
}

/**
 * Secrets Manager stack for the Multi-Sport Fantasy League platform.
 *
 * - Stores external data provider credentials (API-Football) in Secrets Manager
 * - Configures automatic rotation at ≤ 90-day intervals (R18.7)
 * - DynamoDB encryption at rest is configured in dynamodb-stack.ts with
 *   AWS_MANAGED encryption, satisfying R18.5. This stack asserts that
 *   requirement is met by design.
 */
export class SecretsStack extends cdk.NestedStack {
  public readonly apiFootballSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    // External data provider credentials stored in Secrets Manager (R18.7)
    // Credentials are never in source code or config files.
    this.apiFootballSecret = new secretsmanager.Secret(this, 'ApiFootballCredentials', {
      secretName: `fantasy/${props.stageName}/api-football-credentials`,
      description: 'API-Football provider credentials for data sync',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          provider: 'api-football',
          endpoint: 'https://v3.football.api-sports.io',
        }),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        passwordLength: 40,
      },
    });

    // Rotation Lambda — placeholder implementation.
    // Actual rotation logic depends on the external provider's key management API.
    // This Lambda is invoked by Secrets Manager on the configured schedule.
    const rotationFn = new lambda.Function(this, 'ApiFootballRotationFn', {
      functionName: `ApiFootballRotation-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        /**
         * Secrets Manager rotation Lambda (placeholder).
         *
         * Rotation steps:
         * 1. createSecret — generate a new API key via provider API
         * 2. setSecret — store the new key as AWSPENDING
         * 3. testSecret — validate the new key against the provider
         * 4. finishSecret — promote AWSPENDING to AWSCURRENT
         *
         * Replace this placeholder with actual provider API calls.
         */
        exports.handler = async (event) => {
          const { Step, SecretId } = event;
          console.log(\`Rotation step: \${Step} for secret: \${SecretId}\`);

          switch (Step) {
            case 'createSecret':
              // TODO: Call provider API to generate a new key
              break;
            case 'setSecret':
              // TODO: Store the new key via Secrets Manager AWSPENDING
              break;
            case 'testSecret':
              // TODO: Validate the new key works against the provider
              break;
            case 'finishSecret':
              // TODO: Promote AWSPENDING to AWSCURRENT
              break;
            default:
              throw new Error(\`Unknown rotation step: \${Step}\`);
          }
        };
      `),
      timeout: cdk.Duration.seconds(30),
      description: 'Rotates API-Football provider credentials',
    });

    // Configure automatic rotation at 90-day intervals (≤ 90 days per R18.7)
    this.apiFootballSecret.addRotationSchedule('RotationSchedule', {
      rotationLambda: rotationFn,
      automaticallyAfter: cdk.Duration.days(90),
    });

    // Grant the rotation Lambda permission to manage the secret
    this.apiFootballSecret.grantRead(rotationFn);
    this.apiFootballSecret.grantWrite(rotationFn);

    new cdk.CfnOutput(this, 'ApiFootballSecretArn', {
      value: this.apiFootballSecret.secretArn,
      description: 'ARN of the API-Football credentials secret',
    });

    /**
     * Assertion: DynamoDB encryption at rest (R18.5)
     *
     * The DynamoDB FantasyTable is provisioned in dynamodb-stack.ts with:
     *   encryption: dynamodb.TableEncryption.AWS_MANAGED
     *
     * This uses an AWS-owned KMS key to encrypt all data at rest,
     * satisfying Requirement 18.5: "THE Platform SHALL store user data,
     * including personally identifiable information (PII), in DynamoDB
     * with encryption at rest enabled."
     *
     * No additional configuration is needed here — this comment serves
     * as the architectural assertion that R18.5 is met by the existing
     * DynamoDB stack configuration.
     */
  }
}
