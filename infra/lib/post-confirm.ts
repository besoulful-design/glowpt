import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface PostConfirmationProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  /** The proxy's security group, so we can open 5432 to the Lambda. */
  proxySecurityGroup: ec2.SecurityGroup;
  userPool: cognito.UserPool;
  /** The DB role the Lambda connects as (IAM auth to the proxy). */
  dbUser?: string;
  dbName?: string;
}

/**
 * The Cognito post-confirmation Lambda and everything it needs to reach the
 * database privately, with NO NAT gateway and NO VPC endpoints (Option A):
 *   - It runs inside the VPC's isolated subnets and talks only to the RDS Proxy.
 *   - It authenticates to the proxy with a short-lived IAM token (rds-db:connect),
 *     signed locally from its execution role, so no secret is stored or fetched.
 *   - CloudWatch logging is delivered out-of-band by the Lambda service, so it
 *     works from an isolated subnet without a logs endpoint.
 *
 * The handler reuses the tested SECURITY DEFINER functions. See
 * lambda/post-confirmation/index.ts and glowpt-aws-phase2-auth-design.md.
 */
export class PostConfirmation extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: PostConfirmationProps) {
    super(scope, id);

    const dbUser = props.dbUser ?? 'glowpt_postconfirm';
    const dbName = props.dbName ?? 'glowpt';

    // The Lambda's own security group. It needs to reach the proxy on 5432.
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      description: 'GlowPT post-confirmation Lambda',
      allowAllOutbound: true,
    });
    props.proxySecurityGroup.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      'Postgres from the post-confirmation Lambda',
    );

    // Explicit log group (the deprecated logRetention prop spawns a helper
    // Lambda). Six-month retention matches the audit posture.
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/glowpt-post-confirmation',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      functionName: 'glowpt-post-confirmation',
      entry: path.join(__dirname, '..', 'lambda', 'post-confirmation', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      logGroup,
      environment: {
        DB_PROXY_ENDPOINT: props.proxy.endpoint,
        DB_USER: dbUser,
        DB_NAME: dbName,
        DB_PORT: '5432',
      },
      bundling: {
        // pg and rds-signer installed as real node modules (robust for pg's
        // dynamic requires), the rest esbuild-bundled.
        nodeModules: ['pg', '@aws-sdk/rds-signer'],
        target: 'node22',
      },
    });

    // Let the Lambda mint an IAM auth token for exactly the glowpt_postconfirm
    // DB user on this proxy. This is the whole of Option A's credential story.
    props.proxy.grantConnect(this.fn, dbUser);

    // Fire on confirmed sign-up. addTrigger also grants Cognito invoke rights.
    props.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, this.fn);

    new cdk.CfnOutput(this, 'PostConfirmFnName', {
      value: this.fn.functionName,
      description: 'Post-confirmation Lambda (Cognito trigger)',
    });
  }
}
