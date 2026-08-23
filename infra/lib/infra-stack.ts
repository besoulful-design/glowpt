import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Network } from './network';
import { Database } from './database';
import { Audit } from './audit';
import { Email } from './email';
import { Auth } from './auth';
import { PostConfirmation } from './post-confirm';
import { Api } from './api';
import { AiResponse } from './ai-response';
import { WeeklySummary } from './weekly-summary';
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
    const email = new Email(this, 'Email');

    // Phase 2 auth: the Cognito user pool that emails sign-in codes, routing
    // them through the TLS-required SES configuration set above.
    const auth = new Auth(this, 'Auth', {
      configurationSetName: email.configurationSet.configurationSetName,
    });
    // The config set is referenced by name, so make the ordering explicit.
    auth.node.addDependency(email);

    // The post-confirmation Lambda: creates the user + attaches the clinic in
    // RDS the instant Cognito confirms an email. Reaches the proxy over IAM auth.
    new PostConfirmation(this, 'PostConfirmation', {
      vpc: network.vpc,
      proxy: database.proxy,
      proxySecurityGroup: network.proxySecurityGroup,
      userPool: auth.userPool,
    });

    // Phase 3: the data API. HTTP API Gateway with a Cognito JWT authorizer in
    // front of one Lambda that runs every app read/write as glowpt_app, stamping
    // the verified sub into each transaction so RLS is the boundary.
    const api = new Api(this, 'Api', {
      vpc: network.vpc,
      proxy: database.proxy,
      proxySecurityGroup: network.proxySecurityGroup,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
    });

    // The ai-response function. A separate, non-VPC Lambda (no database), attached
    // to the shared API behind the same Cognito authorizer at POST /ai-response.
    // Runs Claude through Bedrock rather than Anthropic's own API, so the PHI in
    // the prompt is covered by the AWS BAA we already hold instead of needing a
    // second, separately negotiated Anthropic BAA.
    new AiResponse(this, 'AiResponse', {
      httpApi: api.httpApi,
      authorizer: api.authorizer,
    });

    // Phase 4: the weekly-summary function. A VPC Lambda (it needs the private
    // database) that reaches SES through an interface VPC endpoint and fires from
    // an EventBridge rule every Monday at 8am ET. PHI-minimised nudge emails.
    new WeeklySummary(this, 'WeeklySummary', {
      vpc: network.vpc,
      proxy: database.proxy,
      proxySecurityGroup: network.proxySecurityGroup,
      configurationSetName: email.configurationSet.configurationSetName,
    });

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
    new cdk.CfnOutput(this, 'PostconfirmSecretArn', {
      value: database.postconfirmSecret.secretArn,
      description: 'Secrets Manager ARN for the glowpt_postconfirm role (proxy uses it)',
    });
    new cdk.CfnOutput(this, 'WeeklySecretArn', {
      value: database.weeklySecret.secretArn,
      description: 'Secrets Manager ARN for the glowpt_weekly role (proxy uses it)',
    });
    new cdk.CfnOutput(this, 'BastionInstanceId', {
      value: bastion.host.instanceId,
      description: 'SSM bastion instance id (target for aws ssm start-session)',
    });
  }
}
