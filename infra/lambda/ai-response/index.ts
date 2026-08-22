import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * GlowPT ai-response Lambda (Phase 4).
 *
 * Generates the warm daily reflection. Takes { prompt } and returns
 * { response }, a drop-in for the Supabase Edge Function it replaces.
 *
 * What changes on AWS vs the Supabase version (both by the migration plan):
 *   - It sits behind our HTTP API's Cognito JWT authorizer, so ONLY a signed-in
 *     GlowPT user can call it. The old function had no auth of its own (it leaned
 *     on Supabase's gateway verify_jwt) and accepted any { prompt } from anyone,
 *     billing David's Anthropic key. API Gateway has no free equivalent, so the
 *     authorizer on the route is the fix.
 *   - CORS is scoped to the app origins by the HTTP API config, never '*'.
 *   - This function is deliberately NOT in the VPC: it touches no database and
 *     only needs to reach api.anthropic.com, so keeping it outside the sealed
 *     network gives it internet egress for free (no NAT, no VPC endpoint).
 *
 * PHI note: the prompt carries the patient's first name, feeling and free-text
 * note, so Anthropic is a business associate for this call. The Anthropic BAA is
 * a go-live gate (demo data only until then); it is not a code concern here.
 *
 * The Anthropic API key lives in Secrets Manager (never in the template or an
 * env var), fetched once per warm container. The secret's value is the key
 * itself as plain text.
 *
 * Environment:
 *   ANTHROPIC_SECRET_ARN  Secrets Manager ARN/name holding the API key
 *   ANTHROPIC_MODEL       model id (default claude-haiku-4-5-20251001)
 *   AWS_REGION            provided by the Lambda runtime
 */

const {
  ANTHROPIC_SECRET_ARN = '',
  ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001',
  AWS_REGION = 'us-east-1',
} = process.env;

const FALLBACK = "You showed up today — and that's everything.";

const secrets = new SecretsManagerClient({ region: AWS_REGION });

// Cached across warm invocations so we hit Secrets Manager once, not per request.
let cachedKey: string | undefined;

async function anthropicKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const out = await secrets.send(
    new GetSecretValueCommand({ SecretId: ANTHROPIC_SECRET_ARN }),
  );
  const value = (out.SecretString ?? '').trim();
  if (!value) throw new Error('ANTHROPIC_API_KEY secret is empty');
  cachedKey = value;
  return cachedKey;
}

function json(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  // The authorizer has already proven the caller is a signed-in GlowPT user; we
  // do not need their identity for the Anthropic call, only that they are one.

  let prompt: unknown;
  try {
    const raw = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : '{}';
    prompt = JSON.parse(raw)?.prompt;
  } catch {
    // Match the old function's forgiving behaviour: never 500 the patient's
    // check-in over a bad reflection. Fall back gracefully.
    return json(200, { response: FALLBACK });
  }

  if (!prompt || typeof prompt !== 'string') {
    return json(200, { response: FALLBACK });
  }

  try {
    const key = await anthropicKey();
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = (await resp.json()) as { content?: Array<{ text?: string }> };
    const text = data?.content?.[0]?.text ?? FALLBACK;
    return json(200, { response: text });
  } catch (err) {
    // Log to CloudWatch (in-AWS, BAA-covered) and fall back. The reflection is a
    // nicety; a failure must never block or error the check-in save.
    console.error(
      JSON.stringify({
        msg: 'ai-response error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return json(200, { response: FALLBACK });
  }
};
