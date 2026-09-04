import { Signer } from '@aws-sdk/rds-signer';
import { Client } from 'pg';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

/**
 * Cognito post-confirmation Lambda.
 *
 * Fires the instant a user confirms their email code. It creates the user's
 * identity + profile in RDS and attaches them to their clinic, reusing the
 * exact SECURITY DEFINER functions proven by the Phase 1.3 tests. It runs as
 * the dedicated glowpt_postconfirm DB role (the ONLY role that may call
 * register_user), reached through the RDS Proxy with IAM authentication, so no
 * database password is ever stored in or fetched by this function.
 *
 * Design: glowpt-aws-phase2-auth-design.md section 4.
 *
 * Environment:
 *   DB_PROXY_ENDPOINT  RDS Proxy hostname (never the DB directly)
 *   DB_USER            glowpt_postconfirm
 *   DB_NAME            glowpt
 *   DB_PORT            5432
 *   AWS_REGION         provided by the Lambda runtime
 */

const {
  DB_PROXY_ENDPOINT = '',
  DB_USER = 'glowpt_postconfirm',
  DB_NAME = 'glowpt',
  DB_PORT = '5432',
  AWS_REGION = 'us-east-1',
} = process.env;

const PORT = Number(DB_PORT);

// One signer, reused across warm invocations. getAuthToken() mints a fresh,
// short-lived IAM token per call from the function's own execution-role
// credentials; the signing is local, so no network round-trip and no VPC
// endpoint is needed.
const signer = new Signer({
  hostname: DB_PROXY_ENDPOINT,
  port: PORT,
  username: DB_USER,
  region: AWS_REGION,
});

export const handler = async (
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> => {
  // Only the sign-up confirmation path does identity work. There is no password
  // in this pool, so PostConfirmation_ConfirmForgotPassword never fires, but we
  // guard anyway and simply pass the event straight back.
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }

  const sub = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;
  const meta = event.request.clientMetadata ?? {};
  const flow = meta.flow;

  const token = await signer.getAuthToken();

  const client = new Client({
    host: DB_PROXY_ENDPOINT,
    port: PORT,
    user: DB_USER,
    database: DB_NAME,
    password: token,
    // The proxy requires TLS (encryption in transit). rejectUnauthorized is
    // false only because the RDS CA bundle is not pinned in this function yet.
    // TODO(go-live): pin the RDS global CA before real patients, so the proxy
    // certificate is verified, not just the channel encrypted.
    ssl: { rejectUnauthorized: false },
    // Keep the attempt tight. Both of these are enforced client-side by node-pg,
    // so they are safe through RDS Proxy. NOTE: do NOT set statement_timeout here.
    // It is a server startup option and RDS Proxy rejects it ("Feature not
    // supported"), which fails the whole connection. query_timeout is the
    // client-side equivalent and is proxy-safe.
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
  });

  try {
    await client.connect();
    await client.query('begin');

    // Transaction-scoped identity (Rule: never session-level under RDS Proxy).
    // The sub comes from Cognito's verified event, never from user input.
    await client.query('select set_config($1, $2, true)', ['app.user_id', sub]);

    // Always create the identity + bare profile first (idempotent).
    await client.query('select register_user($1, $2, $3)', [
      sub,
      email,
      meta.full_name ?? null,
    ]);

    // Then attach to a clinic based on which path the user came through. Every
    // branch is idempotent, so a retry (or the frontend safety-net re-run) is safe.
    switch (flow) {
      case 'join':
        await client.query('select join_clinic($1, $2, $3)', [
          meta.clinic_slug,
          meta.full_name ?? null,
          meta.consent_version ?? null,
        ]);
        break;
      case 'onboard':
        await client.query('select provision_clinic($1, $2)', [
          meta.onboard_clinic_name,
          meta.onboard_clinic_slug,
        ]);
        break;
      case 'patient_invite':
        // An invited patient. Separate from 'staff' because this door records
        // consent, which the staff one deliberately cannot.
        await client.query('select accept_patient_invite($1, $2)', [
          meta.staff_token ?? null,
          meta.consent_version ?? null,
        ]);
        break;
      case 'staff':
        // The token identifies which invite. It is not a credential: the
        // function still requires this user's verified email to match the
        // invited address. Null (an older link) falls back to email matching.
        await client.query('select accept_staff_invite($1)', [meta.staff_token ?? null]);
        break;
      default:
        // No/unknown flow: the identity row still exists; the frontend NoClinic
        // gate handles attaching later. Not an error.
        console.warn(JSON.stringify({ msg: 'post-confirm: no clinic flow', sub, flow }));
    }

    await client.query('commit');
    console.log(JSON.stringify({ msg: 'post-confirm ok', sub, flow }));
  } catch (err) {
    // Deliberate choice (see design section 4 "Safety net"): do NOT throw. The
    // user is already confirmed in Cognito; throwing would only reject their
    // ConfirmSignUp call for work that is idempotent and self-healing. Instead
    // log loudly to CloudWatch (in-AWS, BAA-covered) and return the event. The
    // frontend re-runs the same idempotent attach on first sign-in. A Phase-4
    // metric/alarm on this log line makes the failure visible, not silent.
    try {
      await client.query('rollback');
    } catch {
      /* connection may be dead; ignore */
    }
    console.error(
      JSON.stringify({
        msg: 'post-confirm FAILED (self-heal on next sign-in)',
        sub,
        flow,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  } finally {
    await client.end().catch(() => {
      /* ignore */
    });
  }

  return event;
};
