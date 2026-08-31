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
      // PINNED ON PURPOSE. BastionHostLinux otherwise resolves "latest Amazon
      // Linux" at synth time, so the moment AWS publishes a new image every
      // deploy wants to REPLACE this instance, whatever the deploy was
      // actually for. That is not harmless: the replacement hands back a new
      // instance id, and the id is written into the DB runbook in CLAUDE.md
      // and into every "start the bastion, open the tunnel" instruction.
      //
      // This is the AMI the host already runs. Frozen is the right default for
      // a jump host that opens no inbound ports and sits stopped between
      // sessions. Bump it deliberately, in its own change, not as a side
      // effect of shipping something else.
      machineImage: ec2.MachineImage.genericLinux({
        'us-east-1': 'ami-068e33c5263812a9b',
      }),
    });
  }
}
