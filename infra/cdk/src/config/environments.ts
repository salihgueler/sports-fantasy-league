/**
 * Deployment stage configuration.
 * Each stage maps to a target AWS account/region pair.
 */

export interface StageConfig {
  readonly stageName: string;
  readonly account?: string;
  readonly region: string;
  readonly description: string;
  /** Allowed CORS origins for this stage. Must not use wildcard in production. */
  readonly allowedOrigins?: string[];
}

export const stages: Record<string, StageConfig> = {
  dev: {
    stageName: 'dev',
    region: 'us-east-1',
    description: 'Development environment for local testing and CI',
    allowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
  },
  prod: {
    stageName: 'prod',
    region: 'us-east-1',
    description: 'Production environment',
    allowedOrigins: ['https://fantasy-league.example.com'],
  },
};

/**
 * Resolve stage from CDK context or environment variable.
 * Defaults to "dev" when not specified.
 */
export function resolveStage(contextStage?: string): StageConfig {
  const name = contextStage ?? process.env.DEPLOY_STAGE ?? 'dev';
  const config = stages[name];
  if (!config) {
    throw new Error(`Unknown stage "${name}". Valid stages: ${Object.keys(stages).join(', ')}`);
  }
  return config;
}
