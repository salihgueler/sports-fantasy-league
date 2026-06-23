#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RootStack } from '../lib/root-stack';
import { resolveStage } from '../config/environments';

const app = new cdk.App();

const stage = resolveStage(app.node.tryGetContext('stage'));

new RootStack(app, `FantasyLeague-${stage.stageName}`, {
  stage,
  env: {
    account: stage.account ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: stage.region,
  },
  description: `Multi-Sport Fantasy League — ${stage.description}`,
});
