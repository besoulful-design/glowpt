import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Network } from './network';
import { Database } from './database';
import { Audit } from './audit';
import { Email } from './email';

/**
 * GlowPT AWS foundation.
 *
 * Network + encrypted RDS Postgres 17.6 (Multi-AZ) + RDS Proxy + CloudTrail
 * audit log + SES TLS configuration set. Everything the migration's later
 * phases build on. Account glowpt-prod (463556655381), region us-east-1.
 */
export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const network = new Network(this, 'Network');

    const database = new Database(this, 'Database', {
      vpc: network.vpc,
      dbSecurityGroup: network.dbSecurityGroup,
      proxySecurityGroup: network.proxySecurityGroup,
    });

    new Audit(this, 'Audit');
    new Email(this, 'Email');

    // Values the later phases need. The app always connects to the proxy
    // endpoint, never straight to the database.
    new cdk.CfnOutput(this, 'DbProxyEndpoint', {
      value: database.proxy.endpoint,
      description: 'RDS Proxy endpoint the app connects to',
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: database.instance.secret!.secretArn,
      description: 'Secrets Manager ARN holding the DB admin credentials',
    });
  }
}
