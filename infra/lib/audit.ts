import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';

/**
 * Audit logging for the account.
 *
 * CloudTrail records who did what in AWS, kept six years to satisfy the HIPAA
 * documentation-retention requirement (164.316(b)(2)(i)). The first management
 * trail is free; only the small S3 storage is billed.
 */
export class Audit extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // Never auto-delete audit logs, even if this stack is torn down.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Move older logs to cheap cold storage, then expire at ~6 years.
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
          expiration: cdk.Duration.days(2192),
        },
      ],
    });

    new cloudtrail.Trail(this, 'Trail', {
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });
  }
}
