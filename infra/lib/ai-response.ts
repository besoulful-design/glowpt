import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as path from 'path';

/**
 * ⚠️ THE BEDROCK QUOTA LIVES IN THE MANAGEMENT ACCOUNT, NOT HERE.
 *
 * Measured 2026-09-15: every Anthropic Haiku 4.5 quota in glowpt-prod
 * (463556655381) is literally 0.0 -- tokens per day, tokens per minute,
 * requests per minute. The management account FranklinAI (456112636877) is
 * fully provisioned (13.5M tokens/day) and had never been tested. That is the
 * whole reason for the cross-account hop below, and it is why five weeks of
 * support cases aimed at raising glowpt-prod's allocation got nowhere: there
 * was no number to raise.
 *
 * The role itself is created by infra/bedrock/create-role.sh, NOT by this
 * stack, because this stack deploys into glowpt-prod and cannot make a role in
 * another account without bootstrapping CDK there.
 */
const BEDROCK_ROLE_ARN = 'arn:aws:iam::456112636877:role/GlowptBedrockInvoke';

/** The US cross-region inference profile. Haiku 4.5 has no on-demand id. */
const BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export interface AiResponseProps {
  /** The shared HTTP API; ai-response attaches one route to it. */
  httpApi: apigwv2.HttpApi;
  /** The same Cognito JWT authorizer the data API uses. */
  authorizer: HttpUserPoolAuthorizer;
  /** Bedrock model id. Defaults to the US Haiku 4.5 inference profile. */
  model?: string;
}

/**
 * The ai-response function: the warm daily reflection.
 *
 * It is a SEPARATE Lambda from the data API and deliberately NOT in the VPC: it
 * touches no database, so staying outside the sealed network gives it free
 * egress to the Bedrock and STS endpoints (no NAT, no VPC endpoint). It attaches
 * a single route, POST /ai-response, to the shared HTTP API behind the SAME
 * Cognito authorizer, which is what stops it being callable by anyone.
 *
 * ⚠️ IT CALLS BEDROCK, NOT api.anthropic.com, AND THAT IS A HIPAA BOUNDARY, NOT
 * A PREFERENCE. The prompt carries the patient's first name, feeling and note,
 * so whoever runs the model is a business associate. Bedrock is covered by the
 * org-level AWS BAA accepted 2026-08-02, which reaches the management account
 * and every member account. Anthropic's own API was NOT covered, which is why
 * this was a go-live gate from 2026-08-02 until 2026-09-15.
 *
 * ⛔ DO NOT ADD AN api.anthropic.com FALLBACK FOR WHEN BEDROCK FAILS. A fallback
 * that sends PHI outside the BAA is worse than no reflection at all. The Lambda
 * already degrades to a fixed line of house copy, which is the correct failure.
 *
 * See lambda/ai-response/index.ts.
 */
export class AiResponse extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: AiResponseProps) {
    super(scope, id);

    // ⛔ THE glowpt/anthropic/api-key SECRET IS GONE. It was deleted on
    // 2026-09-15, deliberately and in its own commit, once Bedrock had served a
    // real patient check-in in production. DO NOT RECREATE IT. A key here would
    // only ever be useful for calling api.anthropic.com, and that call is
    // outside the BAA; see the fallback prohibition in the header.

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/glowpt-ai-response',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ⚠️ THE ROLE NAME IS PINNED ON PURPOSE. The management account's role
    // trusts this exact ARN by name. A CDK-generated name would change on a
    // replacement and silently break the trust, and the only symptom would be
    // every patient quietly getting the fallback line. Do not remove roleName.
    this.role = new iam.Role(this, 'ExecRole', {
      roleName: 'glowpt-ai-response-exec',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for glowpt-ai-response. Named, because the cross-account Bedrock role trusts it by ARN.',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // The ONLY cross-account permission: assume the one Bedrock role, nothing
    // else. The Bedrock permissions themselves live on that role, in the other
    // account, so this side cannot widen them.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [BEDROCK_ROLE_ARN],
      }),
    );

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      functionName: 'glowpt-ai-response',
      entry: path.join(__dirname, '..', 'lambda', 'ai-response', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Bedrock answers Haiku in well under a second, but the assume-role hop
      // and a cold start deserve headroom. Still tight enough to fail fast.
      timeout: cdk.Duration.seconds(30),
      role: this.role,
      // No vpc: no database, and the public endpoints are reachable for free.
      logGroup,
      environment: {
        BEDROCK_ROLE_ARN,
        BEDROCK_MODEL_ID: props.model ?? BEDROCK_MODEL_ID,
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-sts'],
        target: 'node22',
      },
    });

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
    new cdk.CfnOutput(this, 'AiResponseRoleArn', {
      value: this.role.roleArn,
      description: 'Execution role the management account Bedrock role must trust',
    });
  }
}
