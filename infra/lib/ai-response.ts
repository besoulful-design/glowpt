import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as path from 'path';

/**
 * Regions the US cross-region inference profile may route to. IAM must allow
 * the underlying foundation model in EVERY one of them, or the call fails
 * intermittently depending on where Bedrock lands it — a nasty, load-dependent
 * bug that looks fine in testing.
 */
const US_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];

/** Bare foundation model id behind the profile. */
const FOUNDATION_MODEL = 'anthropic.claude-haiku-4-5-20251001-v1:0';

/** US-scoped inference profile. Deliberately not the `global.` one — see below. */
const DEFAULT_PROFILE = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export interface AiResponseProps {
  /** The shared HTTP API; ai-response attaches one route to it. */
  httpApi: apigwv2.HttpApi;
  /** The same Cognito JWT authorizer the data API uses. */
  authorizer: HttpUserPoolAuthorizer;
  /** Bedrock inference profile id. Defaults to the US Haiku 4.5 profile. */
  modelId?: string;
}

/**
 * The ai-response function: the warm daily reflection.
 *
 * Runs Claude Haiku 4.5 through **Amazon Bedrock**, not Anthropic's own API.
 * The reason is legal, not technical: the prompt carries PHI, so the model host
 * is a business associate. Bedrock is HIPAA-eligible and is already covered by
 * GlowPT's org-level AWS BAA (Active 2026-08-02, all member accounts), whereas
 * Anthropic's 1P API BAA is a separate, non-self-serve agreement that has to be
 * signed by the org's Primary Owner. Same model, same version, one less
 * contract — and it removes the last gate in front of real patients.
 *
 * Still a SEPARATE Lambda from the data API and deliberately NOT in the VPC: it
 * touches no database, and Bedrock's endpoint is public like Anthropic's was,
 * so egress needs did not change (no NAT, no VPC endpoint). It attaches a
 * single route, POST /ai-response, behind the SAME Cognito authorizer.
 *
 * There is no API key any more. The execution role IS the credential, so the
 * stored Anthropic secret is no longer read by anything.
 *
 * See lambda/ai-response/index.ts.
 */
export class AiResponse extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AiResponseProps) {
    super(scope, id);

    const modelId = props.modelId ?? DEFAULT_PROFILE;

    // ── The old Anthropic API key ────────────────────────────────────────────
    // RETAINED ON PURPOSE, though nothing reads it any more. Removing the
    // construct would schedule the secret for deletion, and it still holds the
    // live `glowpt-aws` key — the rollback path if Bedrock has to be reverted.
    // Delete it deliberately, in its own change, once Bedrock has run in
    // production for a while. Until then it is a parked credential, not a leak:
    // the Lambda no longer has read access to it (the grant below is gone).
    this.secret = new secretsmanager.Secret(this, 'AnthropicKey', {
      secretName: 'glowpt/anthropic/api-key',
      description:
        'LEGACY Anthropic API key. Unused since the Bedrock switch; kept only as the rollback path.',
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/glowpt-ai-response',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      functionName: 'glowpt-ai-response',
      entry: path.join(__dirname, '..', 'lambda', 'ai-response', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Model calls take a couple of seconds; headroom without being generous.
      timeout: cdk.Duration.seconds(30),
      // No vpc: no database, and Bedrock's endpoint is reachable publicly.
      logGroup,
      environment: {
        BEDROCK_MODEL_ID: modelId,
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        target: 'node22',
      },
    });

    // ── Bedrock permissions ─────────────────────────────────────────────────
    // Scoped to this one model, never a wildcard on bedrock:*.
    // A cross-region inference profile needs BOTH:
    //   (a) invoke on the profile ARN (account-owned, in this region), and
    //   (b) invoke on the foundation model in every region it can route to.
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            resource: 'inference-profile',
            resourceName: modelId,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
          ...US_PROFILE_REGIONS.map(
            (region) =>
              `arn:${cdk.Stack.of(this).partition}:bedrock:${region}::foundation-model/${FOUNDATION_MODEL}`,
          ),
        ],
      }),
    );

    // One route on the shared API, behind the same Cognito authorizer.
    props.httpApi.addRoutes({
      path: '/ai-response',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('AiResponseIntegration', this.fn),
      authorizer: props.authorizer,
    });

    new cdk.CfnOutput(this, 'AiResponseFnName', {
      value: this.fn.functionName,
      description: 'ai-response Lambda name',
    });
    new cdk.CfnOutput(this, 'AiResponseModelId', {
      value: modelId,
      description: 'Bedrock inference profile the reflection runs on',
    });
  }
}
