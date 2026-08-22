import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface DatabaseProps {
  vpc: ec2.Vpc;
  dbSecurityGroup: ec2.SecurityGroup;
  proxySecurityGroup: ec2.SecurityGroup;
}

/**
 * The GlowPT database and the proxy in front of it.
 *
 * Production-grade posture (David's call, 2026-08-10): Multi-AZ standby,
 * 35-day backups, deletion protection on, customer-managed encryption key.
 */
export class Database extends Construct {
  public readonly instance: rds.DatabaseInstance;
  public readonly proxy: rds.DatabaseProxy;
  /**
   * Credentials for the glowpt_postconfirm DB role, registered with the proxy.
   * CDK generates the password; a deploy-time bastion step sets the DB role's
   * password to match (ALTER ROLE), the same out-of-band pattern used for the
   * admin role. The Lambda never reads this secret: it authenticates to the
   * proxy with an IAM token, and the proxy uses this secret to reach the DB.
   */
  public readonly postconfirmSecret: secretsmanager.Secret;
  /**
   * Credentials for the glowpt_app DB role, registered with the proxy. Same
   * out-of-band pattern as postconfirmSecret: CDK generates the password, a
   * deploy-time bastion step sets the role's password to match. The API Lambda
   * never reads it; it IAM-auths to the proxy and the proxy uses this secret to
   * reach the DB as glowpt_app. Right now glowpt_app has a random throwaway
   * password on RDS (Phase 2 testing) so it cannot log in; this is where its
   * real credential gets set (migration-plan Phase 3).
   */
  public readonly appSecret: secretsmanager.Secret;
  /**
   * Credentials for the glowpt_weekly DB role, registered with the proxy. Same
   * out-of-band pattern as the app/postconfirm secrets: CDK generates the
   * password, a deploy-time bastion step sets the role's password to match. The
   * weekly-summary Lambda never reads it; it IAM-auths to the proxy and the proxy
   * uses this secret to reach the DB as glowpt_weekly.
   */
  public readonly weeklySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    // Our own encryption key for data at rest, with yearly rotation. HIPAA
    // requires encryption at rest; a customer-managed key is ours to control
    // and audit. Retained if the stack is ever torn down so encrypted data
    // and snapshots stay readable.
    const key = new kms.Key(this, 'DbKey', {
      description: 'GlowPT RDS encryption at rest',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.of('17.6', '17'),
    });

    // Force SSL on every connection (encryption in transit). This is the
    // rds.force_ssl = 1 parameter the plan requires; it lives in a parameter group.
    const parameterGroup = new rds.ParameterGroup(this, 'ParamGroup', {
      engine,
      description: 'GlowPT Postgres 17: force SSL on all connections',
      parameters: {
        'rds.force_ssl': '1',
      },
    });

    this.instance = new rds.DatabaseInstance(this, 'Postgres', {
      engine,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.dbSecurityGroup],
      multiAz: true, // live standby copy in the second availability zone
      allocatedStorage: 20,
      maxAllocatedStorage: 100, // storage grows automatically up to this ceiling
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: key,
      credentials: rds.Credentials.fromGeneratedSecret('glowpt_admin'),
      databaseName: 'glowpt',
      parameterGroup,
      backupRetention: cdk.Duration.days(35),
      deletionProtection: true,
      cloudwatchLogsExports: ['postgresql'],
      // On an intentional teardown, keep a final snapshot rather than losing data.
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // The glowpt_postconfirm role's credentials. Username is fixed; the password
    // is generated here and reconciled onto the DB role at deploy time. No
    // punctuation, so it pastes cleanly into an ALTER ROLE over the bastion.
    this.postconfirmSecret = new secretsmanager.Secret(this, 'PostconfirmSecret', {
      secretName: 'glowpt/db/postconfirm',
      description: 'glowpt_postconfirm DB role credentials (used by the RDS Proxy)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'glowpt_postconfirm' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // The glowpt_app role's credentials, same shape as the postconfirm secret.
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: 'glowpt/db/app',
      description: 'glowpt_app DB role credentials (used by the RDS Proxy)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'glowpt_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // The glowpt_weekly role's credentials, same shape as the others. Used by
    // the weekly-summary Lambda (via the proxy) for the cross-clinic read.
    this.weeklySecret = new secretsmanager.Secret(this, 'WeeklySecret', {
      secretName: 'glowpt/db/weekly',
      description: 'glowpt_weekly DB role credentials (used by the RDS Proxy)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'glowpt_weekly' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // RDS Proxy: required, not an optimization (Rule 9). Lambda plus Postgres
    // exhausts raw connections without it. TLS from the client to the proxy is
    // mandatory here. IAM auth lets the post-confirmation Lambda connect with a
    // short-lived token instead of a stored password; the proxy holds both the
    // admin secret and the postconfirm secret and uses the matching one per the
    // connecting DB username.
    this.proxy = new rds.DatabaseProxy(this, 'Proxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(this.instance),
      secrets: [this.instance.secret!, this.postconfirmSecret, this.appSecret, this.weeklySecret],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.proxySecurityGroup],
      requireTLS: true,
      iamAuth: true,
    });
  }
}
