import { readFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

const ENV = { account: '111111111111', region: 'us-east-1' };

/**
 * An App whose VPC gets the REAL us-east-1 availability zones.
 *
 * ⚠️ WITHOUT THIS THE WHOLE SUITE THROWS. A synth-only stack has no AZ lookup, so
 * CDK hands it dummy1a/dummy1b/dummy1c -- and the Cognito interface endpoint is
 * deliberately pinned to us-east-1b (AWS does not offer cognito-idp in every AZ;
 * 1a is one of the ones it does not), so filtering the isolated subnets by that
 * AZ found nothing and every test died on CannotCreateEndpointSubnets.
 *
 * ⛔ THE FIX BELONGS HERE, NOT IN lib/api.ts. Making the pin fall back to
 * "whatever AZ this VPC happens to have" would turn a loud CloudFormation refusal
 * into a silent deploy into an AZ where the endpoint does not exist. The pin is
 * correct; the test simply has to model a real region.
 */
function app() {
  return new cdk.App({
    context: {
      [`availability-zones:account=${ENV.account}:region=${ENV.region}`]: [
        'us-east-1a', 'us-east-1b', 'us-east-1c',
        'us-east-1d', 'us-east-1e', 'us-east-1f',
      ],
    },
  });
}

// Smoke test: the stack synthesizes and contains the core pieces.
test('foundation synthesizes with a Multi-AZ encrypted database and a proxy', () => {
  const stack = new InfraStack(app(), 'TestStack', { env: ENV });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    MultiAZ: true,
    StorageEncrypted: true,
  });
  template.resourceCountIs('AWS::RDS::DBProxy', 1);
});

// Phase 3: the data API. The authorizer authenticates; RLS authorizes.
test('data API: HTTP API with a Cognito JWT authorizer, one public route, scoped CORS', () => {
  const stack = new InfraStack(app(), 'TestStack', { env: ENV });
  const template = Template.fromStack(stack);

  // Exactly one HTTP API, and its CORS is scoped to named origins, never '*'.
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  const apis = template.findResources('AWS::ApiGatewayV2::Api');
  const cors = (Object.values(apis)[0] as any).Properties.CorsConfiguration;
  expect(cors.AllowOrigins).not.toContain('*');
  expect(cors.AllowOrigins.length).toBeGreaterThan(0);
  // The two addresses the built frontend is actually served from.
  expect(cors.AllowOrigins).toContain('https://glowpt.app');
  expect(cors.AllowOrigins).toContain('https://main.dvewl3gkeo718.amplifyapp.com');

  // A JWT authorizer exists (verifies the Cognito token at the door).
  template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    AuthorizerType: 'JWT',
  });

  // ⚠️ THE PUBLIC SURFACE IS THE POINT OF THIS ASSERTION. Exactly two routes may
  // be reached without a token, and both must be, because the caller has no
  // account yet at that moment:
  //   - the /join slug lookup, so a walk-in page can name its clinic;
  //   - the invite lookup, so an invite link can say which clinic and role it
  //     is for. Its token is 256 bits of randomness and grants nothing by
  //     itself; claiming the invite still requires a verified matching email.
  // Anything else appearing here is a route that forgot its authorizer, so add
  // to this list only deliberately.
  //
  // (The invite route shipped 2026-09-04 and this list was not updated with it,
  // so the suite was red until 2026-09-05. A stale expectation is not a passing
  // test with a footnote; it is a broken alarm.)
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  const byAuth: Record<string, string[]> = { JWT: [], NONE: [] };
  for (const r of Object.values(routes) as any[]) {
    const key = r.Properties.RouteKey as string;
    const authType = r.Properties.AuthorizationType as string;
    (byAuth[authType] ??= []).push(key);
  }
  expect([...byAuth.NONE].sort()).toEqual([
    'GET /clinics/by-slug/{slug}',
    'GET /staff-invites/{token}',
  ]);
  expect(byAuth.JWT).toContain('GET /me');
  expect(byAuth.JWT).toContain('GET /clinic/roster');
  // 16 data routes (ai-response adds a 17th JWT route, asserted in the Phase 4 test).
  expect(byAuth.JWT.length).toBeGreaterThanOrEqual(16);

  // The glowpt_app role's secret exists and is one of the proxy's FOUR auth
  // entries: the RDS admin secret plus one per Lambda role (postconfirm, app,
  // weekly). Each is a separate least-privilege DB role, which is why the count
  // is worth asserting: a fifth appearing unnoticed means something gained
  // database access without anyone deciding it should.
  //
  // (This read 3 until 2026-09-05. glowpt/db/weekly was added with
  // weekly-summary on 2026-08-22 and the count was never updated, so this
  // assertion had been failing for two weeks.)
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'glowpt/db/app' });
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'glowpt/db/weekly' });
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'glowpt/db/postconfirm' });
  const proxies = template.findResources('AWS::RDS::DBProxy');
  expect((Object.values(proxies)[0] as any).Properties.Auth.length).toBe(4);
});

// Phase 4: ai-response behind the same authorizer, but OUTSIDE the VPC.
test('ai-response: POST /ai-response is JWT-protected and its Lambda is not in the VPC', () => {
  const stack = new InfraStack(app(), 'TestStack', { env: ENV });
  const template = Template.fromStack(stack);

  // The route exists and requires the JWT authorizer (the old function's fix).
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  const aiRoute = Object.values(routes).find(
    (r: any) => r.Properties.RouteKey === 'POST /ai-response',
  ) as any;
  expect(aiRoute).toBeDefined();
  expect(aiRoute.Properties.AuthorizationType).toBe('JWT');

  // The ai-response Lambda must NOT be in the VPC (it needs Bedrock and STS and
  // touches no DB). A VpcConfig would mean no egress without a NAT.
  const fns = template.findResources('AWS::Lambda::Function');
  const aiFn = Object.values(fns).find(
    (f: any) => f.Properties.FunctionName === 'glowpt-ai-response',
  ) as any;
  expect(aiFn).toBeDefined();
  expect(aiFn.Properties.VpcConfig).toBeUndefined();

  // It calls Bedrock, in the management account, through the US inference
  // profile. Haiku 4.5 has no on-demand model id, so a bare model id 400s.
  expect(aiFn.Properties.Environment.Variables.BEDROCK_MODEL_ID).toBe(
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  );
  expect(aiFn.Properties.Environment.Variables.BEDROCK_ROLE_ARN).toBe(
    'arn:aws:iam::456112636877:role/GlowptBedrockInvoke',
  );
});

/**
 * ⚠️ THE EXECUTION ROLE NAME IS PART OF A CONTRACT WITH ANOTHER AWS ACCOUNT.
 *
 * infra/bedrock/trust-policy.json lets exactly one ARN assume the Bedrock role,
 * and that ARN is this name. Rename it, drop the roleName and let CDK generate
 * one, or replace the role some other way, and the trust silently stops
 * matching: no deploy error, no alarm, just every patient quietly receiving the
 * fallback line instead of a reflection. Nothing else in the stack would notice.
 */
test('ai-response: the exec role name is pinned, because another account trusts it by ARN', () => {
  const stack = new InfraStack(app(), 'TestStack', { env: ENV });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'glowpt-ai-response-exec',
  });

  // And it may assume the Bedrock role, which is the only cross-account grant.
  const policies = template.findResources('AWS::IAM::Policy');
  const assumesBedrock = Object.values(policies).some((p: any) =>
    JSON.stringify(p.Properties.PolicyDocument).includes(
      'arn:aws:iam::456112636877:role/GlowptBedrockInvoke',
    ),
  );
  expect(assumesBedrock).toBe(true);
});

/**
 * ⛔ PHI MUST NOT LEAVE THE BAA. The prompt carries the patient's first name,
 * feeling and note, so the model's operator is a business associate. Bedrock is
 * covered by the org-level AWS BAA; api.anthropic.com is not. This test fails if
 * anyone reintroduces a direct Anthropic call as a "fallback" for a Bedrock
 * outage, which is the plausible way it would come back.
 */
test('ai-response: nothing in the Lambda source calls api.anthropic.com', () => {
  const src = readFileSync(
    path.join(__dirname, '..', 'lambda', 'ai-response', 'index.ts'),
    'utf8',
  );
  const mentions = src.split('\n').filter((l) => l.includes('api.anthropic.com'));
  // The file names the address in its own prohibition. Any line that mentions it
  // must be a comment saying not to, never code.
  for (const line of mentions) expect(line.trimStart().startsWith('*')).toBe(true);
  expect(src).not.toContain('x-api-key');
});

// Weekly summary fires Sunday 6pm Eastern, year-round (David, 2026-09-07).
// The fire time is the week's cutoff (the Lambda counts the 7 days ending
// then), so the day and the time zone are product decisions, not plumbing.
test('weekly-summary: fires Sunday 18:00 America/New_York via Scheduler, no UTC rule left', () => {
  const stack = new InfraStack(app(), 'TestStack', { env: ENV });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    Name: 'glowpt-weekly-summary',
    ScheduleExpression: 'cron(0 18 ? * SUN *)',
    ScheduleExpressionTimezone: 'America/New_York',
    State: 'ENABLED',
  });
  // The old UTC-only EventBridge rule (Monday 12:00 UTC) must be gone, or the
  // job fires twice a week.
  expect(Object.keys(template.findResources('AWS::Events::Rule'))).toEqual([]);
});
