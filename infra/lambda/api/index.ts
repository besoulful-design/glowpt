import { Signer } from '@aws-sdk/rds-signer';
import { Client } from 'pg';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * GlowPT data API Lambda (Phase 3).
 *
 * One Lambda behind an HTTP API Gateway. The gateway's built-in Cognito JWT
 * authorizer proves WHO is calling (it verifies the token's signature, issuer,
 * audience and expiry before this code runs). This function decides NOTHING
 * about which rows the caller may see: it opens a transaction, stamps in the
 * caller's verified Cognito `sub` with set_config('app.user_id', sub, true),
 * runs the query, and commits. Row Level Security is the boundary (Rule: the
 * authorizer authenticates, RLS authorizes).
 *
 * It connects as the dedicated glowpt_app DB role through the RDS Proxy with an
 * IAM token (no stored DB password), exactly like the post-confirmation Lambda.
 * glowpt_app is fully governed by RLS and cannot mint identities (no
 * register_user grant).
 *
 * Rules honoured here:
 *   - set_config is ALWAYS transaction-scoped (`true`), never session-level:
 *     RDS Proxy multiplexes connections across callers, so a session-level value
 *     would leak across tenants. See db/schema.sql.
 *   - The sub comes ONLY from the gateway-verified JWT claims, never from a
 *     header, body, path or query string.
 *   - No identifier (uuid, email, check-in id) appears in any URL path or query
 *     string. Identity is the token; entity ids that must be named (assign a
 *     therapist, discharge a patient) travel in the JSON body, which is not
 *     logged by API Gateway or a CDN the way a path is.
 *
 * Design: glowpt-aws-migration-plan.md Phase 3; call-site map in
 * glowpt-supabase-inventory.md section 3.
 *
 * Environment:
 *   DB_PROXY_ENDPOINT  RDS Proxy hostname (never the DB directly)
 *   DB_USER            glowpt_app
 *   DB_NAME            glowpt
 *   DB_PORT            5432
 *   AWS_REGION         provided by the Lambda runtime
 */

const {
  DB_PROXY_ENDPOINT = '',
  DB_USER = 'glowpt_app',
  DB_NAME = 'glowpt',
  DB_PORT = '5432',
  AWS_REGION = 'us-east-1',
} = process.env;

const PORT = Number(DB_PORT);

// One signer, reused across warm invocations. getAuthToken() mints a fresh,
// short-lived IAM token per call, signed locally from the execution role, so no
// network round-trip and no VPC endpoint is needed.
const signer = new Signer({
  hostname: DB_PROXY_ENDPOINT,
  port: PORT,
  username: DB_USER,
  region: AWS_REGION,
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown> | unknown[];

function json(statusCode: number, body: Json): APIGatewayProxyResultV2 {
  // CORS response headers are added by the HTTP API's CORS config, not here.
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** A thrown HttpError becomes a clean JSON response instead of a 500. */
class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function connect(): Promise<Client> {
  const token = await signer.getAuthToken();
  const client = new Client({
    host: DB_PROXY_ENDPOINT,
    port: PORT,
    user: DB_USER,
    database: DB_NAME,
    password: token,
    // The proxy requires TLS. rejectUnauthorized is false only because the RDS
    // CA bundle is not pinned in this function yet.
    // TODO(go-live): pin the RDS global CA so the proxy cert is verified.
    ssl: { rejectUnauthorized: false },
    // Client-side timeouts (proxy-safe; server-side statement_timeout is NOT).
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
  });
  await client.connect();
  return client;
}

/**
 * Run `work` inside a transaction with the caller's identity stamped in. The
 * sub is the gateway-verified Cognito subject. Always transaction-scoped.
 */
async function withUser<T>(
  client: Client,
  sub: string,
  work: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query('select set_config($1, $2, true)', ['app.user_id', sub]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* connection may be dead; ignore */
    }
    throw err;
  }
}

/** The verified Cognito subject, or throw 401. Never read from anything but the JWT claims. */
function requireSub(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub || typeof sub !== 'string') throw new HttpError(401, 'unauthenticated');
  return sub;
}

// ---------------------------------------------------------------------------
// Route handlers. Each receives the connected client and the event, and returns
// a JSON-serialisable value (wrapped into a 200) or throws HttpError.
// Authenticated handlers do their DB work inside withUser(...).
// ---------------------------------------------------------------------------

// -- Public: the only unauthenticated data read in the app (resolve a clinic for
//    /join). Goes through get_clinic_by_slug, never a blanket clinics read. The
//    slug is a public clinic handle, not an identifier for a person.
async function getClinicBySlug(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const slug = event.pathParameters?.slug;
  if (!slug) throw new HttpError(400, 'slug_required');
  const { rows } = await client.query(
    'select id, name, slug, is_active from public.get_clinic_by_slug($1)',
    [slug],
  );
  if (!rows[0]) throw new HttpError(404, 'clinic_not_found');
  return json(200, rows[0]);
}

// -- Profile: load the caller's own profile. A pure read. If no profile row
//    exists yet (e.g. a total post-confirm miss), returns 404 profile_missing so
//    the frontend's NoClinic gate can drive the attach flow. (glowpt_app cannot
//    call register_user; ensuring a missing identity row is the post-confirm
//    Lambda's job, tracked as a Phase-3 follow-up in the migration notes.)
async function getMe(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const row = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      `select id, clinic_id, role, full_name, therapist_id, discharged_at, created_at
         from public.profiles
        where id = public.current_user_id()`,
    );
    return rows[0];
  });
  if (!row) throw new HttpError(404, 'profile_missing');
  return json(200, row);
}

// -- Profile: update the caller's own name. The column-scoped grant
//    (update (full_name)) plus profiles_update_self mean role/clinic_id cannot
//    be touched here even if asked.
async function patchMe(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const body = parseBody(event);
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : null;
  if (!fullName) throw new HttpError(400, 'full_name_required');
  await withUser(client, sub, async (c) => {
    await c.query(
      'update public.profiles set full_name = $1 where id = public.current_user_id()',
      [fullName],
    );
  });
  return json(200, { ok: true });
}

// -- Consents: record a HIPAA acknowledgment for the caller. user_id is forced
//    to the caller server-side (RLS also requires it).
async function postConsent(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const body = parseBody(event);
  const version = typeof body.version === 'string' && body.version ? body.version : 'v1';
  const type =
    typeof body.type === 'string' && body.type ? body.type : 'hipaa_patient_ack';
  await withUser(client, sub, async (c) => {
    await c.query(
      `insert into public.consents (user_id, clinic_id, type, version)
       values (public.current_user_id(), public.auth_clinic_id(), $1, $2)`,
      [type, version],
    );
  });
  return json(201, { ok: true });
}

// -- Check-ins: the caller's own recent window plus their all-time total, in one
//    round trip (replaces the two frontend reads). RLS scopes to the caller.
async function getMyCheckins(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const since = event.queryStringParameters?.since; // ISO timestamp, computed client-side
  const result = await withUser(client, sub, async (c) => {
    const list = await c.query(
      `select feeling, feeling_word, movements, other_movement, note, ai_response, created_at
         from public.checkins
        where user_id = public.current_user_id()
          and ($1::timestamptz is null or created_at >= $1::timestamptz)
        order by created_at asc`,
      [since ?? null],
    );
    const count = await c.query(
      'select count(*)::int as total from public.checkins where user_id = public.current_user_id()',
    );
    return { checkins: list.rows, total: count.rows[0].total as number };
  });
  return json(200, result);
}

// -- Check-ins: record today's check-in. The database enforces one row per user
//    per UTC day (checkins_one_per_day), so this is a clean upsert on that key
//    instead of the old read-then-write race. clinic_id is derived server-side
//    from the caller's profile (RLS also requires clinic_id = auth_clinic_id()).
async function postMyCheckin(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);

  const feeling = Number(b.feeling);
  if (!Number.isInteger(feeling)) throw new HttpError(400, 'feeling_required');

  const feelingWord = typeof b.feeling_word === 'string' ? b.feeling_word : null;
  const movements = Array.isArray(b.movements) ? (b.movements as string[]) : null;
  const otherMovement = typeof b.other_movement === 'string' ? b.other_movement : null;
  const note = typeof b.note === 'string' ? b.note : null;
  const aiResponse = typeof b.ai_response === 'string' ? b.ai_response : null;

  const row = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      `insert into public.checkins
         (user_id, clinic_id, feeling, feeling_word, movements, other_movement, note, ai_response)
       values
         (public.current_user_id(), public.auth_clinic_id(), $1, $2, $3, $4, $5, $6)
       on conflict (user_id, public.utc_date(created_at)) do update
         set feeling        = excluded.feeling,
             feeling_word   = excluded.feeling_word,
             movements      = excluded.movements,
             other_movement = excluded.other_movement,
             note           = excluded.note,
             ai_response    = excluded.ai_response
       returning id`,
      [feeling, feelingWord, movements, otherMovement, note, aiResponse],
    );
    return rows[0];
  });
  return json(200, row);
}

// -- Clinic: the caller's own clinic (name/slug for the dashboard header).
async function getClinic(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const row = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      'select id, name, slug, activated_at from public.clinics where id = public.auth_clinic_id()',
    );
    return rows[0];
  });
  if (!row) throw new HttpError(404, 'clinic_not_found');
  return json(200, row);
}

// -- Clinic roster: the two RLS-scoped reads the dashboard stitches, PLUS the
//    HIPAA access-log row, all in ONE transaction (the plan's requirement: the
//    roster endpoint writes its access_log row in the same transaction as the
//    read). A manager sees the whole clinic; a therapist sees only their
//    caseload; RLS decides which, not this code.
async function getRoster(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const result = await withUser(client, sub, async (c) => {
    const patients = await c.query(
      `select id, full_name, created_at, therapist_id, discharged_at
         from public.profiles
        where role = 'patient'`,
    );
    const checkins = await c.query(
      `select user_id, feeling, feeling_word, note, created_at
         from public.checkins
        order by created_at desc`,
    );
    // Audit the staff view in the same transaction. actor_id is forced to the
    // caller (RLS access_log_insert_own also requires it).
    await c.query(
      `insert into public.access_log (actor_id, action, clinic_id)
       values (public.current_user_id(), 'view_roster', public.auth_clinic_id())`,
    );
    return { patients: patients.rows, checkins: checkins.rows };
  });
  return json(200, result);
}

// -- Clinic: the therapists list for care-team management (manager-only by RLS).
async function getTherapists(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const result = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      `select id, full_name
         from public.profiles
        where clinic_id = public.auth_clinic_id() and role = 'therapist'
        order by full_name`,
    );
    return rows;
  });
  return json(200, { therapists: result });
}

// -- Clinic: pending staff invites (manager-only by RLS).
async function getInvites(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const result = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      `select email, full_name, role
         from public.staff_invites
        where consumed_at is null
        order by created_at desc`,
    );
    return rows;
  });
  return json(200, { invites: result });
}

// ---------------------------------------------------------------------------
// RPCs: the six SECURITY DEFINER functions port as-is. Each re-derives the
// caller's clinic and role inside Postgres, so the Lambda only forwards typed
// arguments (from the JSON body, never the URL). join_clinic and
// accept_staff_invite are the frontend's idempotent re-attach safety net.
// ---------------------------------------------------------------------------

async function rpcProvisionClinic(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const slug = typeof b.slug === 'string' ? b.slug.trim() : '';
  if (!name || !slug) throw new HttpError(400, 'name_and_slug_required');
  const clinicId = await withUser(client, sub, async (c) => {
    const { rows } = await c.query('select public.provision_clinic($1, $2) as clinic_id', [
      name,
      slug,
    ]);
    return rows[0].clinic_id as string;
  });
  return json(200, { clinic_id: clinicId });
}

async function rpcJoinClinic(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const slug = typeof b.slug === 'string' ? b.slug.trim() : '';
  if (!slug) throw new HttpError(400, 'slug_required');
  const fullName = typeof b.full_name === 'string' ? b.full_name : null;
  const consentVersion = typeof b.consent_version === 'string' ? b.consent_version : null;
  const clinicId = await withUser(client, sub, async (c) => {
    const { rows } = await c.query(
      'select public.join_clinic($1, $2, $3) as clinic_id',
      [slug, fullName, consentVersion],
    );
    return rows[0].clinic_id as string;
  });
  return json(200, { clinic_id: clinicId });
}

async function rpcAcceptStaffInvite(
  client: Client,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
) {
  const sub = requireSub(event);
  const clinicId = await withUser(client, sub, async (c) => {
    const { rows } = await c.query('select public.accept_staff_invite() as clinic_id');
    return rows[0].clinic_id as string | null;
  });
  return json(200, { clinic_id: clinicId });
}

async function rpcInviteStaff(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!email) throw new HttpError(400, 'email_required');
  const fullName = typeof b.full_name === 'string' ? b.full_name : null;
  const role = typeof b.role === 'string' && b.role ? b.role : 'therapist';
  await withUser(client, sub, async (c) => {
    await c.query('select public.invite_staff($1, $2, $3)', [email, fullName, role]);
  });
  return json(200, { ok: true });
}

async function rpcAssignTherapist(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const patientId = typeof b.patient_id === 'string' ? b.patient_id : '';
  if (!patientId) throw new HttpError(400, 'patient_id_required');
  // therapist_id may be null (unassign).
  const therapistId = typeof b.therapist_id === 'string' ? b.therapist_id : null;
  await withUser(client, sub, async (c) => {
    await c.query('select public.assign_therapist($1, $2)', [patientId, therapistId]);
  });
  return json(200, { ok: true });
}

async function rpcDischargePatient(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const patientId = typeof b.patient_id === 'string' ? b.patient_id : '';
  if (!patientId) throw new HttpError(400, 'patient_id_required');
  await withUser(client, sub, async (c) => {
    await c.query('select public.discharge_patient($1)', [patientId]);
  });
  return json(200, { ok: true });
}

async function rpcRestorePatient(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const patientId = typeof b.patient_id === 'string' ? b.patient_id : '';
  if (!patientId) throw new HttpError(400, 'patient_id_required');
  await withUser(client, sub, async (c) => {
    await c.query('select public.restore_patient($1)', [patientId]);
  });
  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Router. Keyed on API Gateway's routeKey ("METHOD /path"). Adding a route here
// AND in infra/lib/api.ts is deliberate: the CDK route list is the allow-list.
// ---------------------------------------------------------------------------

type Route = (
  client: Client,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
) => Promise<APIGatewayProxyResultV2>;

// ----------------------------- platform admin -----------------------------
// Cross-clinic operator surface. Authorisation is NOT decided here: every
// admin_* function re-checks public.is_platform_admin() itself and raises
// 42501, which the shared error handler maps to 403. These routes
// are ordinary JWT-authorised routes — being signed in is not being an admin.

async function getAdminMe(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const result = await withUser(client, sub, async (c) =>
    c.query('select public.is_platform_admin() as is_admin'),
  );
  return json(200, { is_admin: result.rows[0]?.is_admin === true });
}

async function getAdminClinics(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const result = await withUser(client, sub, async (c) =>
    c.query('select * from public.admin_list_clinics()'),
  );
  return json(200, { clinics: result.rows });
}

async function postAdminActivation(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const clinicId = typeof b.clinic_id === 'string' ? b.clinic_id : '';
  if (!clinicId) throw new HttpError(400, 'clinic_id_required');
  if (typeof b.active !== 'boolean') throw new HttpError(400, 'active_required');
  const result = await withUser(client, sub, async (c) =>
    c.query('select public.admin_set_clinic_active($1, $2) as activated_at', [clinicId, b.active]),
  );
  return json(200, { activated_at: result.rows[0]?.activated_at ?? null });
}

async function postAdminBaa(client: Client, event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const sub = requireSub(event);
  const b = parseBody(event);
  const clinicId = typeof b.clinic_id === 'string' ? b.clinic_id : '';
  const version = typeof b.version === 'string' ? b.version : '';
  if (!clinicId) throw new HttpError(400, 'clinic_id_required');
  if (!version) throw new HttpError(400, 'version_required');
  const result = await withUser(client, sub, async (c) =>
    c.query('select public.admin_record_baa($1, $2) as baa_signed_at', [clinicId, version]),
  );
  return json(200, { baa_signed_at: result.rows[0]?.baa_signed_at ?? null });
}

const ROUTES: Record<string, Route> = {
  'GET /clinics/by-slug/{slug}': getClinicBySlug, // public
  'GET /me': getMe,
  'PATCH /me': patchMe,
  'POST /me/consents': postConsent,
  'GET /me/checkins': getMyCheckins,
  'POST /me/checkins': postMyCheckin,
  'GET /clinic': getClinic,
  'GET /clinic/roster': getRoster,
  'GET /clinic/therapists': getTherapists,
  'GET /clinic/invites': getInvites,
  'POST /rpc/provision-clinic': rpcProvisionClinic,
  'POST /rpc/join-clinic': rpcJoinClinic,
  'POST /rpc/accept-staff-invite': rpcAcceptStaffInvite,
  'POST /rpc/invite-staff': rpcInviteStaff,
  'POST /rpc/assign-therapist': rpcAssignTherapist,
  'POST /rpc/discharge-patient': rpcDischargePatient,
  'POST /rpc/restore-patient': rpcRestorePatient,
  'GET /admin/me': getAdminMe,
  'GET /admin/clinics': getAdminClinics,
  'POST /admin/clinics/activation': postAdminActivation,
  'POST /admin/clinics/baa': postAdminBaa,
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const route = ROUTES[event.routeKey];
  if (!route) return json(404, { error: 'not_found', routeKey: event.routeKey });

  let client: Client | undefined;
  try {
    client = await connect();
    return await route(client, event);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    // Always log the full error to CloudWatch (in-AWS, BAA-covered).
    const message = err instanceof Error ? err.message : String(err);
    const sqlstate = (err as { code?: string })?.code;
    console.error(
      JSON.stringify({ msg: 'api error', routeKey: event.routeKey, sqlstate, error: message }),
    );
    // Only a deliberate RPC raise (SQLSTATE P0001, e.g. "Only a clinic manager
    // can invite staff") is safe to echo back to the caller: those messages are
    // authored by us and carry no row data. Every other Postgres error (a
    // constraint violation could quote a value, an internal fault could leak
    // schema detail) returns a generic message instead.
    if (sqlstate === 'P0001') return json(400, { error: 'request_failed', detail: message });
    // 42501 = insufficient_privilege. Raised deliberately by the admin_* RPCs
    // when the caller is not a platform admin, and by Postgres itself when a
    // grant is missing. Either way it is an authorisation failure, not a
    // malformed request, so it gets a 403 and the frontend can act on it.
    if (sqlstate === '42501') return json(403, { error: 'forbidden' });
    return json(400, { error: 'request_failed' });
  } finally {
    await client?.end().catch(() => {
      /* ignore */
    });
  }
};
