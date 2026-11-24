#!/usr/bin/env node
// Boilerplate del kit: aplicación CDK con un solo stack por ambiente.
import * as cdk from 'aws-cdk-lib';
import { EvaStack } from '../lib/eva-stack';

const app = new cdk.App();
const ambiente: string = app.node.tryGetContext('env') ?? 'dev';

new EvaStack(app, `eva-${ambiente}`, {
  stackName: `eva-${ambiente}`,
  ambiente,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

cdk.Tags.of(app).add('proyecto', 'eva');
cdk.Tags.of(app).add('ambiente', ambiente);
