import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
}

/**
 * Cognito User Pool stack for the Multi-Sport Fantasy League platform.
 *
 * Provisions:
 * - User Pool with email sign-in, email verification, and password policy
 *   (min 8 chars, uppercase, lowercase, digits, symbols)
 * - User Pool Client with SRP + refresh token auth flows
 * - Access token validity: 60 minutes (R1.3, R1.5)
 * - Refresh token validity: 30 days (R1.6)
 * - preventUserExistenceErrors enabled (R1.9)
 * - Account recovery via verified email only
 *
 * NOTE: Cognito does not natively support 5-failures/15-min lockout (R1.10).
 * This is handled by the Auth Service Lambda with a custom throttle counter.
 */
export class AuthStack extends cdk.NestedStack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `FantasyUserPool-${props.stageName}`,
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      userVerification: {
        emailSubject: 'Verify your Fantasy League email',
        emailBody: 'Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `FantasyWebClient-${props.stageName}`,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
  }
}
