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

  // Every route but the /join slug lookup is JWT-protected; that one is public.
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  const byAuth: Record<string, string[]> = { JWT: [], NONE: [] };
  for (const r of Object.values(routes) as any[]) {
    const key = r.Properties.RouteKey as string;
    const authType = r.Properties.AuthorizationType as string;
    (byAuth[authType] ??= []).push(key);
  }
  expect(byAuth.NONE).toEqual(['GET /clinics/by-slug/{slug}']);
  expect(byAuth.JWT).toContain('GET /me');
  expect(byAuth.JWT).toContain('GET /clinic/roster');
  expect(byAuth.JWT.length).toBe(16);

  // The glowpt_app role's secret exists and is one of the proxy's three auth entries.
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'glowpt/db/app' });
  const proxies = template.findResources('AWS::RDS::DBProxy');
  expect((Object.values(proxies)[0] as any).Properties.Auth.length).toBe(3);
});
