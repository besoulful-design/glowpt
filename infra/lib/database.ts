import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';

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

    // RDS Proxy: required, not an optimization (Rule 9). Lambda plus Postgres
    // exhausts raw connections without it. TLS from the client to the proxy is
    // mandatory here.
    this.proxy = new rds.DatabaseProxy(this, 'Proxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(this.instance),
      secrets: [this.instance.secret!],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.proxySecurityGroup],
      requireTLS: true,
    });
  }
}
