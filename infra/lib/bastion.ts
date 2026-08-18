import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface BastionProps {
  vpc: ec2.Vpc;
}

/**
 * A small SSM jump-host for one-off database admin (schema loads, tests).
 *
 * It has no open inbound ports and no SSH key: the only way to reach it is
 * through AWS Session Manager, which we use to tunnel psql to the private
 * database. Stop the instance (or remove this construct) when not in use;
 * a t4g.nano costs only a few dollars a month while running.
 */
export class Bastion extends Construct {
  public readonly host: ec2.BastionHostLinux;

  constructor(scope: Construct, id: string, props: BastionProps) {
    super(scope, id);

    this.host = new ec2.BastionHostLinux(this, 'Host', {
      vpc: props.vpc,
      // Public subnet so the SSM agent can reach AWS with no NAT gateway.
      // Still no inbound ports are opened; Session Manager is outbound only.
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
    });
  }
}
