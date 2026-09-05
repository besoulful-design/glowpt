import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

// Smoke test: the stack synthesizes and contains the core pieces.
test('foundation synthesizes with a Multi-AZ encrypted database and a proxy', () => {
  const app = new cdk.App();
  const stack = new InfraStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
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
  const app = new cdk.App();
  const stack = new InfraStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  // Exactly one HTTP API, and its CORS is scoped to named origins, never '*'.
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  const apis = template.findResources('AWS::ApiGatewayV2::Api');
  const cors = (Object.values(apis)[0] as any).Properties.CorsConfiguration;
  expect(cors.AllowOrigins).not.toContain('*');
  expect(cors.AllowOrigins.length).toBeGreaterThan(0);

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
  const app = new cdk.App();
  const stack = new InfraStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  // The route exists and requires the JWT authorizer (the old function's fix).
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  const aiRoute = Object.values(routes).find(
    (r: any) => r.Properties.RouteKey === 'POST /ai-response',
  ) as any;
  expect(aiRoute).toBeDefined();
  expect(aiRoute.Properties.AuthorizationType).toBe('JWT');

  // The ai-response Lambda must NOT be in the VPC (it needs the internet for
  // Anthropic and touches no DB). A VpcConfig would mean no egress without a NAT.
  const fns = template.findResources('AWS::Lambda::Function');
  const aiFn = Object.values(fns).find(
    (f: any) => f.Properties.FunctionName === 'glowpt-ai-response',
  ) as any;
  expect(aiFn).toBeDefined();
  expect(aiFn.Properties.VpcConfig).toBeUndefined();

  // The Anthropic key lives in Secrets Manager, not an env var or the template.
  template.hasResourceProperties('AWS::SecretsManager::Secret', {
    Name: 'glowpt/anthropic/api-key',
  });
});
