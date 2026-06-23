import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

export interface CloudFrontStackProps extends cdk.NestedStackProps {
  readonly stageName: string;
  /** The REST API Gateway execute-api domain (e.g. "abc123.execute-api.us-east-1.amazonaws.com") */
  readonly apiGatewayDomain: string;
  /** The API Gateway stage path (e.g. "dev" or "prod") */
  readonly apiStageName: string;
}

/**
 * CloudFront distribution with WAF Web ACL for the Multi-Sport Fantasy League platform.
 *
 * Security controls:
 * - HTTP → HTTPS redirect (R18.1)
 * - TLS 1.2 minimum protocol version (R18.1)
 * - WAF Web ACL with AWS Managed Rules for SQLi and XSS protection (R18.8)
 *
 * Performance (R19.1):
 * - Read-path caching (10s default TTL, 60s max) on /api/competitions/*, /api/players/*, /api/standings/*
 * - Absorbs repeated reads from 10k concurrent users, keeping p95 read latency ≤ 200 ms
 * - Write paths (/api/* catch-all) remain uncached to preserve consistency
 *
 * Origins:
 * - API Gateway REST API (backend)
 * - S3 bucket for static frontend assets
 */
export class CloudFrontStack extends cdk.NestedStack {
  public readonly distribution: cloudfront.Distribution;
  public readonly webBucket: s3.Bucket;
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);

    // S3 bucket for static frontend assets (apps/web build output)
    this.webBucket = new s3.Bucket(this, 'WebAssetsBucket', {
      bucketName: `fantasy-web-assets-${props.stageName}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    // WAF Web ACL — must be in us-east-1 for CloudFront (scope: CLOUDFRONT)
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `FantasyWebAcl-${props.stageName}`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `FantasyWebAcl-${props.stageName}`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Origin Access Control for S3
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.webBucket);

    // API Gateway origin
    const apiOrigin = new origins.HttpOrigin(props.apiGatewayDomain, {
      originPath: `/${props.apiStageName}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Cache policy for read-heavy API paths (competitions, players, standings).
    // Short TTL (10s default, 60s max) ensures freshness while absorbing repeated
    // reads from 10k concurrent users, keeping p95 read latency ≤ 200 ms (R19.1).
    const apiReadCachePolicy = new cloudfront.CachePolicy(this, 'ApiReadCachePolicy', {
      cachePolicyName: `FantasyApiReadCache-${props.stageName}`,
      comment: 'Short-TTL cache for read-heavy API paths (R19.1)',
      defaultTtl: cdk.Duration.seconds(10),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(60),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Fantasy League CDN - ${props.stageName}`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      webAclId: this.webAcl.attrArn,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        // Read-heavy paths — short-TTL cache absorbs repeated reads (R19.1)
        '/api/competitions/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: apiReadCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
        '/api/players/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: apiReadCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
        '/api/standings/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: apiReadCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
        // All other API paths — no cache (writes, auth, etc.)
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'WebBucketName', {
      value: this.webBucket.bucketName,
      description: 'S3 bucket for web assets',
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF Web ACL ARN',
    });
  }
}
