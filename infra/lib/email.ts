import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';

/**
 * SES configuration set that forces TLS on delivery.
 *
 * SES does not require TLS by default and does not validate the receiving
 * certificate. This set makes encryption in transit non-optional for every
 * send that uses it. Free. Sends get wired to this set in Phase 4.
 */
export class Email extends Construct {
  public readonly configurationSet: ses.ConfigurationSet;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.configurationSet = new ses.ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: 'glowpt-transactional',
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
    });
  }
}
