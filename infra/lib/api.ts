import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as path from 'path';

export interface ApiProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  /** The proxy's security group, so we can open 5432 to the API Lambda. */
  proxySecurityGroup: ec2.SecurityGroup;
  /** The Cognito pool + client the gateway authorizer validates tokens against. */
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  /** The DB role the Lambda connects as (IAM auth to the proxy). */
  dbUser?: string;
  dbName?: string;
  /** Browser origins allowed to call the API (CORS). Never '*'. */
  allowOrigins?: string[];
}

/**
 * Phase 3: the GlowPT data API.
 *
 * An HTTP API (API Gateway v2) with a built-in Cognito JWT authorizer in front
 * of a single Lambda that runs every one of the app's data reads and writes.
 * The authorizer verifies the caller's Cognito token at the door; the Lambda
 * stamps the verified sub into a transaction and lets RLS decide the rows
 * (Rule: the authorizer authenticates, RLS authorizes).
 *
 * The Lambda reaches the database privately with NO NAT and NO VPC endpoints,
 * exactly like the post-confirmation Lambda (Option A): isolated subnets, talks
 * only to the RDS Proxy, IAM-token auth as glowpt_app.
 *
 * See lambda/api/index.ts for the handler and the route -> SQL mapping.
 */
export class Api extends Construct {
  public readonly fn: lambdaNode.NodejsFunction;
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const dbUser = props.dbUser ?? 'glowpt_app';
    const dbName = props.dbName ?? 'glowpt';
    const allowOrigins = props.allowOrigins ?? [
      'https://glowpt.app',
      'https://www.glowpt.app',
      'https://glowpt-app.netlify.app',
    ];

    // The Lambda's own security group; it needs to reach the proxy on 5432.
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      description: 'GlowPT data API Lambda',
      allowAllOutbound: true,
    });
    props.proxySecurityGroup.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      'Postgres from the data API Lambda',
    );

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/glowpt-api',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      functionName: 'glowpt-api',
      entry: path.join(__dirname, '..', 'lambda', 'api', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      logGroup,
      environment: {
        DB_PROXY_ENDPOINT: props.proxy.endpoint,
        DB_USER: dbUser,
        DB_NAME: dbName,
        DB_PORT: '5432',
      },
      bundling: {
        // pg + rds-signer as real node modules (pg's dynamic requires), the rest
        // esbuild-bundled. Same recipe proven by the post-confirmation Lambda.
        nodeModules: ['pg', '@aws-sdk/rds-signer'],
        target: 'node22',
      },
    });

    // Mint an IAM auth token for exactly the glowpt_app DB user on this proxy.
    props.proxy.grantConnect(this.fn, dbUser);

    const integration = new HttpLambdaIntegration('ApiIntegration', this.fn);

    // The Cognito JWT authorizer. It validates signature, issuer, audience and
    // expiry before the Lambda runs. Audience is the app client, so the FRONTEND
    // MUST send the Cognito ID token (aud = client id), not the access token.
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'glowpt-api',
      // Authenticated by default; the one public route opts out explicitly below.
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ---- Route allow-list. Must mirror ROUTES in lambda/api/index.ts. ----
    const authed: Array<[string, apigwv2.HttpMethod]> = [
      ['/me', apigwv2.HttpMethod.GET],
      ['/me', apigwv2.HttpMethod.PATCH],
      ['/me/consents', apigwv2.HttpMethod.POST],
      ['/me/checkins', apigwv2.HttpMethod.GET],
      ['/me/checkins', apigwv2.HttpMethod.POST],
      ['/clinic', apigwv2.HttpMethod.GET],
      ['/clinic/roster', apigwv2.HttpMethod.GET],
      ['/clinic/therapists', apigwv2.HttpMethod.GET],
      ['/clinic/invites', apigwv2.HttpMethod.GET],
      ['/rpc/provision-clinic', apigwv2.HttpMethod.POST],
      ['/rpc/join-clinic', apigwv2.HttpMethod.POST],
      ['/rpc/accept-staff-invite', apigwv2.HttpMethod.POST],
      ['/rpc/invite-staff', apigwv2.HttpMethod.POST],
      ['/rpc/assign-therapist', apigwv2.HttpMethod.POST],
      ['/rpc/discharge-patient', apigwv2.HttpMethod.POST],
      ['/rpc/restore-patient', apigwv2.HttpMethod.POST],
    ];
    for (const [routePath, method] of authed) {
      this.httpApi.addRoutes({ path: routePath, methods: [method], integration });
    }

    // The ONLY unauthenticated route: resolve a clinic by slug for /join. Opt out
    // of the default authorizer. The handler routes it to get_clinic_by_slug,
    // which returns one clinic's public fields (never the whole customer list).
    this.httpApi.addRoutes({
      path: '/clinics/by-slug/{slug}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: new apigwv2.HttpNoneAuthorizer(),
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'GlowPT data API base URL (the frontend calls this in Phase 5)',
    });
    new cdk.CfnOutput(this, 'ApiFnName', {
      value: this.fn.functionName,
      description: 'Data API Lambda name',
    });
  }
}
