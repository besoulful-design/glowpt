import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

// Smoke test: the stack synthesizes and contains the core pieces.
test('foundation synthesizes with a Multi-AZ encrypted database and a proxy', () => {
  const app = new cdk.App();
  const stack = new InfraStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    MultiAZ: true,
    StorageEncrypted: true,
  });
  template.resourceCountIs('AWS::RDS::DBProxy', 1);
});
