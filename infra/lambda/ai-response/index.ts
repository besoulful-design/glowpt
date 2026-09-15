import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * GlowPT ai-response Lambda.
 *
 * Generates the warm daily reflection. Takes { prompt } and returns { response }.
 *
 * ⚠️ THIS CALLS BEDROCK, AND THAT IS THE HIPAA BOUNDARY. The prompt carries the
 * patient's first name, feeling and free-text note, so whoever runs the model is
 * a business associate. Bedrock is covered by the org-level AWS BAA accepted
 * 2026-08-02. Until 2026-09-15 this function called api.anthropic.com instead,
 * which was NOT covered, and that single call was the last thing standing
 * between GlowPT and real patients.
 *
 * ⛔ NEVER ADD AN api.anthropic.com FALLBACK. Not for an outage, not for a
 * throttle, not "just while Bedrock is flaky". A fallback that sends PHI outside
 * the BAA is worse than no reflection: the failure would be silent, and the
 * breach would look exactly like success. The correct failure is FALLBACK below,
 * one line of house copy, which is what every error path already returns.
 *
 * ⚠️ IT BORROWS THE MANAGEMENT ACCOUNT'S BEDROCK QUOTA. Measured 2026-09-15,
 * every Haiku 4.5 quota in glowpt-prod is literally 0.0 while FranklinAI
 * (456112636877) is fully provisioned. So this assumes a role there and calls
 * Bedrock as that account. The role grants ONE action on ONE model; see
 * infra/bedrock/. If glowpt-prod's quota is ever raised, the hop can be deleted
 * and the client pointed at the local account, changing nothing else.
 *
 * Auth: it sits behind the HTTP API's Cognito JWT authorizer, so only a signed-in
 * GlowPT user can call it. CORS is scoped to the app origins, never '*'.
 *
 * Environment:
 *   BEDROCK_ROLE_ARN  role to assume in the management account
 *   BEDROCK_MODEL_ID  inference profile id (Haiku 4.5 has no on-demand id)
 *   AWS_REGION        provided by the Lambda runtime
 */

const {
  BEDROCK_ROLE_ARN = '',
  BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  AWS_REGION = 'us-east-1',
} = process.env;

const FALLBACK = "You showed up today, and that's everything.";

/** Matches the old Anthropic call, so reflections keep their length and shape. */
const MAX_TOKENS = 200;

const sts = new STSClient({ region: AWS_REGION });

/**
 * One Bedrock client for the life of the container.
 *
 * The credentials are a PROVIDER FUNCTION rather than a fetched value: the SDK
 * memoises what it returns and calls it again only once `expiration` is near, so
 * a warm container assumes the role roughly once an hour instead of once per
 * reflection. Do not "simplify" this by assuming the role inside the handler.
 */
const bedrock = new BedrockRuntimeClient({
  region: AWS_REGION,
  credentials: async () => {
    const out = await sts.send(
      new AssumeRoleCommand({
        RoleArn: BEDROCK_ROLE_ARN,
        RoleSessionName: 'glowpt-ai-response',
        DurationSeconds: 3600,
      }),
    );
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
      throw new Error('AssumeRole returned no credentials');
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration,
    };
  },
});

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
  // do not need their identity for the model call, only that they are one.

  let prompt: unknown;
  try {
    const raw = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : '{}';
    prompt = JSON.parse(raw)?.prompt;
  } catch {
    // Never 500 a patient's check-in over a bad reflection. Fall back gracefully.
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
        inferenceConfig: { maxTokens: MAX_TOKENS },
      }),
    );
    const text = out.output?.message?.content?.[0]?.text?.trim();
    return json(200, { response: text || FALLBACK });
  } catch (err) {
    // Log to CloudWatch (in AWS, BAA covered) and fall back. The reflection is a
    // nicety; a failure must never block or error the check-in save.
    //
    // ⚠️ THE MESSAGE ONLY, NEVER THE PROMPT. The prompt is PHI and CloudWatch
    // logs are read casually.
    console.error(
      JSON.stringify({
        msg: 'ai-response error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return json(200, { response: FALLBACK });
  }
};
