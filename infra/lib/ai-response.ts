import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as path from 'path';

export interface AiResponseProps {
  /** The shared HTTP API; ai-response attaches one route to it. */
  httpApi: apigwv2.HttpApi;
  /** The same Cognito JWT authorizer the data API uses. */
  authorizer: HttpUserPoolAuthorizer;
  /** Anthropic model id. Defaults to the current Haiku. */
  model?: string;
}

/**
 * Phase 4: the ai-response function on AWS.
 *
 * Generates the warm daily reflection. It is a SEPARATE Lambda from the data API
 * and deliberately NOT in the VPC: it touches no database and only needs to
 * reach api.anthropic.com, so staying outside the sealed network gives it free
 * internet egress (no NAT, no VPC endpoint). It attaches a single route,
 * POST /ai-response, to the shared HTTP API behind the SAME Cognito authorizer,
 * which is the real fix for the old function being callable by anyone.
 *
 * The Anthropic API key lives in Secrets Manager (glowpt/anthropic/api-key). CDK
 * creates the secret with a random placeholder; the real key is set out of band
 * (AWS console) so it never enters the template, the repo, or chat. Until it is
 * set, the function simply returns the graceful fallback line.
 *
 * See lambda/ai-response/index.ts.
 */
export class AiResponse extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AiResponseProps) {
    super(scope, id);

    // The Anthropic API key. Placeholder value now; David sets the real key in
    // the console after deploy. The key's value is the whole secret string.
    this.secret = new secretsmanager.Secret(this, 'AnthropicKey', {
      secretName: 'glowpt/anthropic/api-key',
      description: 'Anthropic API key for the ai-response Lambda (set the value in the console)',
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
      // Anthropic calls take a couple of seconds; give headroom but stay tight.
      timeout: cdk.Duration.seconds(30),
      // No vpc: this function needs the public internet (Anthropic) and no DB.
      logGroup,
      environment: {
        ANTHROPIC_SECRET_ARN: this.secret.secretArn,
        ANTHROPIC_MODEL: props.model ?? 'claude-haiku-4-5-20251001',
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-secrets-manager'],
        target: 'node22',
      },
    });

    // Read-only access to just this one secret.
    this.secret.grantRead(this.fn);

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
    new cdk.CfnOutput(this, 'AnthropicSecretArn', {
      value: this.secret.secretArn,
      description: 'Secrets Manager ARN for the Anthropic API key (set its value in the console)',
    });
  }
}
