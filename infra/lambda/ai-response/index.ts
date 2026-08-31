import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * GlowPT ai-response Lambda.
 *
 * Generates the warm daily reflection. Takes { prompt } and returns
 * { response } — the contract the frontend has always called, unchanged.
 *
 * ── WHY BEDROCK INSTEAD OF api.anthropic.com (2026-08-23) ───────────────────
 * The prompt carries PHI (patient first name, feeling, movement, free-text
 * note), so whoever runs the model is a business associate and needs a BAA.
 *
 * Calling Anthropic's own API directly meant negotiating a SECOND BAA: it is
 * not self-serve, the org's Primary Owner has to sign, and Anthropic then has
 * to enable a HIPAA-ready API organization. That was the last thing standing
 * between GlowPT and real patients.
 *
 * Amazon Bedrock is a HIPAA-eligible AWS service (the eligibility list excludes
 * only the Fable and Mythos models; Haiku is fine). GlowPT already holds an
 * org-level AWS Business Associate Addendum, Active since 2026-08-02, covering
 * every current and future member account including glowpt-prod. So running the
 * SAME model through Bedrock puts this call under a BAA we already have, and
 * the Anthropic BAA stops being a go-live gate at all.
 *
 * Same model, same weights, same version: claude-haiku-4-5-20251001.
 *
 * ── WHY THE us. INFERENCE PROFILE, NOT global. ──────────────────────────────
 * Bedrock offers both `us.anthropic.…` and `global.anthropic.…` profiles. The
 * global one may route inference to any region worldwide. For PHI we pin the
 * US profile so the data stays in US regions. Do NOT "simplify" this to the
 * global profile or to the bare model id — the bare id is not invocable for
 * this model, and global weakens the data-residency story.
 *
 * ── WHAT DID NOT CHANGE ─────────────────────────────────────────────────────
 *   - Still behind the shared HTTP API's Cognito JWT authorizer, so only a
 *     signed-in GlowPT user can call it. That authorizer is what stopped the
 *     old function being callable by anyone holding the public key.
 *   - CORS still scoped to the app origins by the HTTP API config, never '*'.
 *   - Still NOT in the VPC: it touches no database. It now reaches Bedrock's
 *     public endpoint instead of Anthropic's, so egress needs are identical
 *     (no NAT, no VPC endpoint). If this ever moves into the VPC, it will need
 *     a com.amazonaws.<region>.bedrock-runtime interface endpoint.
 *   - Still fails soft: any error logs to CloudWatch (in-AWS, BAA-covered) and
 *     returns the fallback line with a 200. The reflection is a nicety; it must
 *     never block or error the check-in save.
 *
 * No API key any more — the Lambda's execution role is the credential, so the
 * Secrets Manager key is no longer read. That removes a stored secret entirely.
 *
 * Environment:
 *   BEDROCK_MODEL_ID  inference profile id (default: US Haiku 4.5 profile)
 *   AWS_REGION        provided by the Lambda runtime
 */

const {
  BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  AWS_REGION = 'us-east-1',
} = process.env;

const FALLBACK = "You showed up today, and that's everything.";

// Created once per container. No secret fetch on the cold path any more.
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });

function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  // The authorizer has already proven the caller is a signed-in GlowPT user; we
  // do not need their identity for the model call, only that they are one.

  let prompt: unknown;
  try {
    const raw = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : '{}';
    prompt = (JSON.parse(raw) as { prompt?: unknown }).prompt;
  } catch {
    return json(200, { response: FALLBACK });
  }

  if (!prompt || typeof prompt !== 'string') {
    return json(200, { response: FALLBACK });
  }

  try {
    const out = await bedrock.send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 200 },
      }),
    );
    const text = out.output?.message?.content?.[0]?.text?.trim();
    return json(200, { response: text || FALLBACK });
  } catch (err) {
    // Log to CloudWatch (in-AWS, BAA-covered) and fall back. Never surface the
    // error to the patient and never fail the check-in.
    console.error(
      JSON.stringify({
        msg: 'ai-response error',
        modelId: BEDROCK_MODEL_ID,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return json(200, { response: FALLBACK });
  }
};
