import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export interface WeeklySummaryProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  /** The proxy's security group, so we can open 5432 to the Lambda. */
  proxySecurityGroup: ec2.SecurityGroup;
  /** SES configuration set the send goes through (TLS Require). */
  configurationSetName: string;
  /** The DB role the Lambda connects as (IAM auth to the proxy). */
  dbUser?: string;
  dbName?: string;
}

/**
 * The weekly-summary Lambda: PHI-minimised nudge emails, Mondays at 8am ET.
 *
 * Unlike ai-response (which sits OUTSIDE the VPC because it needs the public
 * internet for Anthropic), this Lambda must reach the private database, so it
 * lives in the VPC's isolated subnets. It therefore needs two private paths:
 *   - the RDS Proxy on 5432 (IAM auth as glowpt_weekly, no stored password);
 *   - the SES API on 443, via an interface VPC endpoint, because the isolated
 *     subnets have NO NAT gateway. We use InterfaceVpcEndpointAwsService.EMAIL
 *     (= com.amazonaws.<region>.email, the SES API that SESv2 SendEmail calls),
 *     NOT EMAIL_SMTP / the deprecated SES constant (those are the SMTP interface).
 *
 * Trigger: an EventBridge rule on cron(0 12 ? * MON *) = 12:00 UTC = 8am EDT.
 * Handler: lambda/weekly-summary/index.ts.
 */
export class WeeklySummary extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: WeeklySummaryProps) {
    super(scope, id);

    const dbUser = props.dbUser ?? 'glowpt_weekly';
    const dbName = props.dbName ?? 'glowpt';
    const stack = cdk.Stack.of(this);

    // The Lambda's own security group: reaches the proxy on 5432 and the SES
    // endpoint on 443 (allowAllOutbound covers the egress side of both).
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      description: 'GlowPT weekly-summary Lambda',
      allowAllOutbound: true,
    });
    props.proxySecurityGroup.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      'Postgres from the weekly-summary Lambda',
    );

    // The SES API interface endpoint, with its own SG open ONLY to this Lambda
    // on 443. Placed in the isolated DB subnets (where the Lambda runs); private
    // DNS makes email.<region>.amazonaws.com resolve to it, so the SDK needs no
    // endpoint override.
    const endpointSg = new ec2.SecurityGroup(this, 'SesEndpointSg', {
      vpc: props.vpc,
      description: 'GlowPT SES API VPC endpoint (weekly-summary)',
      allowAllOutbound: true,
    });
    endpointSg.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(443),
      'HTTPS to the SES API from the weekly-summary Lambda',
    );
    props.vpc.addInterfaceEndpoint('SesApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.EMAIL,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [endpointSg],
      privateDnsEnabled: true,
      open: false,
    });

    // Explicit log group (avoids the deprecated logRetention helper Lambda).
    // Six-month retention matches the audit posture of the other functions.
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/glowpt-weekly-summary',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      functionName: 'glowpt-weekly-summary',
      entry: path.join(__dirname, '..', 'lambda', 'weekly-summary', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      logGroup,
      environment: {
        DB_PROXY_ENDPOINT: props.proxy.endpoint,
        DB_USER: dbUser,
        DB_NAME: dbName,
        DB_PORT: '5432',
        SES_CONFIG_SET: props.configurationSetName,
        SES_FROM: 'GlowPT <no-reply@glowpt.app>',
        APP_URL: 'https://glowpt.app',
      },
      bundling: {
        // @aws-sdk/* is externalised by default; the ones we actually need at
        // runtime are installed as real node modules (pg for its dynamic
        // requires, rds-signer for IAM tokens, client-sesv2 for the send).
        nodeModules: ['pg', '@aws-sdk/rds-signer', '@aws-sdk/client-sesv2'],
        target: 'node22',
      },
    });

    // IAM auth to the proxy for exactly the glowpt_weekly DB user.
    props.proxy.grantConnect(this.fn, dbUser);

    // Send permission, scoped to the glowpt.app identity + the transactional
    // config set. Both resources are granted so a send that names the config set
    // passes both the identity and config-set authorization checks.
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${stack.region}:${stack.account}:identity/glowpt.app`,
          `arn:aws:ses:${stack.region}:${stack.account}:configuration-set/${props.configurationSetName}`,
        ],
      }),
    );

    // Monday 08:00 America/New_York. cron(0 12 ? * MON *) = 12:00 UTC = 8am EDT.
    // (During EST/winter this lands at 7am; acceptable for a weekly nudge. A
    // fixed local 8am year-round would need EventBridge Scheduler with a
    // timezone, a later refinement if it matters.)
    new events.Rule(this, 'WeeklyRule', {
      ruleName: 'glowpt-weekly-summary',
      description: 'GlowPT weekly-summary: Monday 08:00 America/New_York (12:00 UTC)',
      schedule: events.Schedule.cron({ minute: '0', hour: '12', weekDay: 'MON' }),
      targets: [new targets.LambdaFunction(this.fn)],
    });

    new cdk.CfnOutput(this, 'WeeklySummaryFnName', {
      value: this.fn.functionName,
      description: 'Weekly-summary Lambda (EventBridge Monday 8am ET)',
    });
  }
}
