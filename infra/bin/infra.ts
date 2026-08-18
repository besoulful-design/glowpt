#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

new InfraStack(app, 'GlowptFoundation', {
  env: { account: '463556655381', region: 'us-east-1' },
  description:
    'GlowPT foundation: VPC, encrypted RDS Postgres 17.6 Multi-AZ + RDS Proxy, CloudTrail, SES TLS config set',
});

// Tag everything for cost tracking and clarity in the console.
cdk.Tags.of(app).add('Project', 'GlowPT');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
