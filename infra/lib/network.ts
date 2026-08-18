import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * The private network for GlowPT.
 *
 * No NAT gateway yet: nothing needs outbound internet until the ai-response
 * Lambda in Phase 4, so this network costs nothing per hour to run. The
 * database lives in isolated subnets that have no route to the internet at all.
 */
export class Network extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly proxySecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // Two availability zones so RDS Multi-AZ has somewhere to place its standby.
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        // Reserved for later (NAT / test tunnel); no cost while empty.
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // The database subnets: no internet route in or out.
        { name: 'db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // What the app and Lambdas will connect to (the proxy), on Postgres port 5432.
    this.proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySg', {
      vpc: this.vpc,
      description: 'GlowPT RDS Proxy: reached by app/Lambdas on 5432',
      allowAllOutbound: true,
    });

    // The database itself. Only the proxy may reach it, nothing else.
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'GlowPT RDS Postgres: reachable only from the RDS Proxy',
      allowAllOutbound: true,
    });
    this.dbSecurityGroup.addIngressRule(
      this.proxySecurityGroup,
      ec2.Port.tcp(5432),
      'Postgres from the RDS Proxy only',
    );
  }
}
