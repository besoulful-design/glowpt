import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Network } from './network';
import { Database } from './database';
import { Audit } from './audit';
import { Email } from './email';
import { Bastion } from './bastion';

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

    // SSM jump-host for one-off DB admin, and the firewall openings that let it
    // reach the database and the proxy on Postgres port 5432.
    const bastion = new Bastion(this, 'Bastion', { vpc: network.vpc });
    const bastionSg = bastion.host.connections.securityGroups[0];
    network.dbSecurityGroup.addIngressRule(
      bastionSg,
      ec2.Port.tcp(5432),
      'Postgres from the SSM bastion tunnel (admin/tests)',
    );
    network.proxySecurityGroup.addIngressRule(
      bastionSg,
      ec2.Port.tcp(5432),
      'Proxy from the SSM bastion tunnel (app tests)',
    );

    // Values the later phases need. The app always connects to the proxy
    // endpoint, never straight to the database.
    new cdk.CfnOutput(this, 'DbProxyEndpoint', {
      value: database.proxy.endpoint,
      description: 'RDS Proxy endpoint the app connects to',
    });
    new cdk.CfnOutput(this, 'DbInstanceEndpoint', {
      value: database.instance.dbInstanceEndpointAddress,
      description: 'RDS instance endpoint (direct admin access via the bastion tunnel)',
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: database.instance.secret!.secretArn,
      description: 'Secrets Manager ARN holding the DB admin credentials',
    });
    new cdk.CfnOutput(this, 'BastionInstanceId', {
      value: bastion.host.instanceId,
      description: 'SSM bastion instance id (target for aws ssm start-session)',
    });
  }
}
