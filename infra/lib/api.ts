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
import * as iam from 'aws-cdk-lib/aws-iam';
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
  /** SES config set (TLS Require) used for the staff invite email. */
  configurationSetName: string;
  /** Public app origin, used to build the invite link inside that email. */
  appUrl?: string;
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
  /** The Cognito JWT authorizer, exposed so sibling routes (ai-response) reuse it. */
  public readonly authorizer: HttpUserPoolAuthorizer;
  /**
   * This Lambda's security group. Exposed so the stack can open the SES API
   * interface endpoint to it: the staff invite email is sent from HERE, and
   * these subnets have no NAT, so the endpoint is the only route to SES.
   */
  public readonly lambdaSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const dbUser = props.dbUser ?? 'glowpt_app';
    const dbName = props.dbName ?? 'glowpt';
    const allowOrigins = props.allowOrigins ?? [
      'https://glowpt.app',
      'https://www.glowpt.app',
      'https://glowpt-app.netlify.app',
      // Local dev (Vite). Low risk: protected routes still require a valid token,
      // and the one public route only exposes a clinic slug lookup.
      'http://localhost:5173',
      'http://127.0.0.1:5173',
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
        SES_CONFIG_SET: props.configurationSetName,
        APP_URL: props.appUrl ?? 'https://glowpt.app',
        FROM_EMAIL: 'GlowPT <no-reply@glowpt.app>',
      },
      bundling: {
        // pg + rds-signer as real node modules (pg's dynamic requires), the rest
        // esbuild-bundled. Same recipe proven by the post-confirmation Lambda.
        nodeModules: ['pg', '@aws-sdk/rds-signer', '@aws-sdk/client-sesv2'],
        target: 'node22',
      },
    });

    this.lambdaSg = lambdaSg;

    // Mint an IAM auth token for exactly the glowpt_app DB user on this proxy.
    props.proxy.grantConnect(this.fn, dbUser);

    // Send the staff invite email. Scoped to the one verified identity and the
    // one TLS-required config set, never a blanket ses:SendEmail on '*'.
    const stack = cdk.Stack.of(this);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${stack.region}:${stack.account}:identity/glowpt.app`,
          `arn:aws:ses:${stack.region}:${stack.account}:configuration-set/${props.configurationSetName}`,
        ],
      }),
    );

    const integration = new HttpLambdaIntegration('ApiIntegration', this.fn);

    // The Cognito JWT authorizer. It validates signature, issuer, audience and
    // expiry before the Lambda runs. Audience is the app client, so the FRONTEND
    // MUST send the Cognito ID token (aud = client id), not the access token.
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });
    this.authorizer = authorizer;

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
      ['/rpc/invite-patient', apigwv2.HttpMethod.POST],
      ['/rpc/accept-patient-invite', apigwv2.HttpMethod.POST],
      ['/rpc/set-open-signup', apigwv2.HttpMethod.POST],
      ['/rpc/assign-therapist', apigwv2.HttpMethod.POST],
      ['/rpc/discharge-patient', apigwv2.HttpMethod.POST],
      ['/rpc/restore-patient', apigwv2.HttpMethod.POST],
      // Platform admin (cross-clinic). Authorised by the DB, not by the route:
      // these carry the same Cognito authorizer as everything else, and each
      // admin_* function refuses a caller who is not in platform_admins.
      ['/admin/me', apigwv2.HttpMethod.GET],
      ['/admin/clinics', apigwv2.HttpMethod.GET],
      ['/admin/clinics/activation', apigwv2.HttpMethod.POST],
      ['/admin/clinics/baa', apigwv2.HttpMethod.POST],
    ];
    for (const [routePath, method] of authed) {
      this.httpApi.addRoutes({ path: routePath, methods: [method], integration });
    }

    // The TWO unauthenticated routes, and the only ones. Both opt out of the
    // default authorizer because they are read by someone who does not have an
    // account yet, which is the whole point of a sign-up page.
    //   * by-slug   -> get_clinic_by_slug, one clinic's public fields for /join.
    //   * staff-invites -> get_staff_invite, so /staff/<token> can name the
    //     clinic and role. Holding the token still does not confer the role:
    //     accept_staff_invite requires the verified email to match.
    for (const publicPath of ['/clinics/by-slug/{slug}', '/staff-invites/{token}']) {
      this.httpApi.addRoutes({
        path: publicPath,
        methods: [apigwv2.HttpMethod.GET],
        integration,
        authorizer: new apigwv2.HttpNoneAuthorizer(),
      });
    }

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
