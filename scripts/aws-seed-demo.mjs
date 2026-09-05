// GlowPT · AWS demo seed/reset (DEMO DATA ONLY — no real patients).
//
// The AWS replacement for the old Supabase seed-demo.mjs / reset-demo.mjs. It
// rebuilds the "Riverside PT" sales-demo clinic from scratch every run (it is
// its own reset): a manager (David), a therapist, and 6 patients incl. the
// showcase patient Grace Bennett (~25 check-ins over 30 days, 14-day streak,
// trending up) so the dashboards + the patient Progress screen look alive.
//
// Each demo person gets BOTH a real Cognito account (so David can sign in AS the
// manager, AS Grace, etc. via the email OTP that lands in his inbox) AND the
// matching database rows + check-in history. All emails are David's Gmail
// +aliases so every sign-in code and weekly email reaches his one inbox.
//
// PREREQUISITES (RDS is private, so a tunnel is required):
//   1. export AWS_PROFILE=glowpt-prod AWS_REGION=us-east-1
//   2. Start the bastion + SSM port-forward to localhost:5433 (see CLAUDE.md
//      "How to reach the RDS DB"): the DB steps in this repo all use that tunnel.
//   3. Provide the DB admin password (never echoed) and run, e.g.:
//        export PGPASSWORD=$(aws secretsmanager get-secret-value \
//          --secret-id "$DB_SECRET_ARN" --query SecretString --output text \
//          | python3 -c "import sys,json;print(json.load(sys.stdin)['password'])")
//        node scripts/aws-seed-demo.mjs
//
// Env (all have sensible defaults except PGPASSWORD):
//   AWS_REGION      (us-east-1)   USER_POOL_ID (us-east-1_q2W6uXTZE)
//   PGHOST (localhost) PGPORT (5433) PGUSER (glowpt_admin) PGDATABASE (glowpt)
//   PGPASSWORD (required)          PGSSLMODE (require)
//
// Idempotent: it deletes any existing Riverside demo (Cognito users + DB rows)
// first, then recreates it, so every run leaves a pristine demo.

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import pg from 'pg';
import crypto from 'node:crypto';

const REGION = process.env.AWS_REGION || 'us-east-1';
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_q2W6uXTZE';
if (!process.env.PGPASSWORD) {
  console.error('Set PGPASSWORD (DB admin password) — see the header of this file.');
  process.exit(1);
}

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const db = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'glowpt_admin',
  database: process.env.PGDATABASE || 'glowpt',
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, // proxy/instance requires TLS; CA not pinned here
});

const CLINIC = { name: 'Riverside PT', slug: 'riverside-pt' };
const alias = (n) => `besoulful+${n}@gmail.com`;
const MANAGER_EMAIL = 'besoulful@gmail.com'; // David signs in here as the clinic manager

const FEELING_WORDS = { 1: 'Really tough', 2: 'Hard day', 3: 'Getting there', 4: 'Good day', 5: 'Feeling great' };
const NOTES = [
  'Stiff this morning but loosened up after my walk.',
  'Did my exercises even though I did not feel like it.',
  'Knee felt good today.',
  'Rested — needed it.',
  'Small win: stairs were easier.',
];
const MOVES = [['PT exercises'], ['PT exercises', 'Walk or light activity'], ['Stretching'], ['Rest day'], ['Walk or light activity']];

// Showcase patient: ~4 weeks of near-daily check-ins, trending upward, with a
// strong current 14-day streak — makes the patient Progress screen shine.
function showcaseCheckins() {
  const recent = [3, 4, 3, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 5]; // last 14 days (ago 13->0), daily => 14-day streak
  const out = recent.map((feeling, idx) => ({ ago: 13 - idx, feeling }));
  const earlier = [
    { ago: 29, feeling: 2 }, { ago: 28, feeling: 3 }, { ago: 26, feeling: 2 }, { ago: 25, feeling: 3 },
    { ago: 23, feeling: 3 }, { ago: 22, feeling: 2 }, { ago: 20, feeling: 4 }, { ago: 19, feeling: 3 },
    { ago: 17, feeling: 3 }, { ago: 16, feeling: 4 }, { ago: 15, feeling: 4 },
  ];
  return [...earlier, ...out];
}

// [name, checkins, email] — checkins is an array of { ago, feeling }.
const PATIENTS = [
  ['Grace Bennett', showcaseCheckins(), alias('grace')], // showcase, log in AS her for the Progress screen
  ['Chris Alvarez', [0, 1, 2, 3, 4, 6].map((ago, i) => ({ ago, feeling: [4, 3, 4, 5, 3, 4][i] })), alias('chris')], // engaged, on track
  ['Maria Chen', [0, 2, 3, 5].map((ago, i) => ({ ago, feeling: [3, 4, 2, 3][i] })), alias('maria')], // engaged, mixed
  ['James Okafor', [8, 9, 11].map((ago, i) => ({ ago, feeling: [3, 4, 3][i] })), alias('james')], // inactive 8+ days -> flag
  ['Linda Park', [0, 1, 3, 4].map((ago, i) => ({ ago, feeling: [2, 2, 3, 4][i] })), alias('linda')], // two recent low -> flag
  ['Robert Ellis', [1, 5, 9].map((ago, i) => ({ ago, feeling: [4, 3, 5][i] })), alias('robert')], // sporadic
];

const ALL_EMAILS = [MANAGER_EMAIL, alias('samtorres'), ...PATIENTS.map((p) => p[2])];

function strongPassword() {
  // Never used (the app signs in via email OTP); must only satisfy the pool policy.
  return 'Aa1!' + crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '');
}

function atDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9, 0, 0, 0); // 9am local; distinct calendar day per "ago"
  return d.toISOString();
}

async function deleteCognitoUser(email) {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  } catch (e) {
    if (e.name !== 'UserNotFoundException') console.warn(`  (cognito delete ${email}: ${e.name})`);
  }
}

async function createCognitoUser(email) {
  const res = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS', // no invite email; these are demo accounts
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  // Move the account to CONFIRMED so email-OTP sign-in works (the password is
  // random and never used; setting it permanent just confirms the user).
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: strongPassword(),
      Permanent: true,
    }),
  );
  const sub = res.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  if (sub) return sub;
  // Fallback: read it back.
  const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  return got.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
}

async function resetDemo() {
  console.log('Resetting any existing Riverside demo...');

  // platform_admins.user_id cascades from users, and every demo account is about
  // to be deleted and recreated with a FRESH Cognito sub. Without this, a routine
  // re-pristine silently strips David of platform-admin access and /admin starts
  // bouncing him with no explanation. Capture by email, restore after seeding —
  // restoring exactly who was an admin before, never granting anyone new.
  const { rows: adminRows } = await db.query(
    `select u.email from public.platform_admins pa join public.users u on u.id = pa.user_id`,
  );
  savedAdminEmails = adminRows.map(r => r.email);
  if (savedAdminEmails.length) console.log(`  preserving platform admin: ${savedAdminEmails.join(', ')}`);

  for (const email of ALL_EMAILS) await deleteCognitoUser(email);
  // DB: deleting the users cascades to profiles/checkins/consents/access_log.
  await db.query('delete from public.users where email = any($1::citext[])', [ALL_EMAILS]);
  await db.query('delete from public.clinics where slug = $1', [CLINIC.slug]);
  console.log('  cleared Cognito users + DB rows.');
}

// Set by resetDemo, consumed after seeding once the new identities exist.
let savedAdminEmails = [];

async function restorePlatformAdmins() {
  if (!savedAdminEmails.length) return;
  const { rowCount } = await db.query(
    `insert into public.platform_admins (user_id)
     select id from public.users where email = any($1::citext[])
     on conflict do nothing`,
    [savedAdminEmails],
  );
  console.log(`Platform admin restored (${rowCount} row${rowCount === 1 ? '' : 's'}).`);
}

async function seedDemo() {
  await db.query('begin');
  try {
    // 1. Clinic
    // ⚠️ TWO flags set explicitly, and for the SAME reason: this script inserts
    // the clinic directly rather than through provision_clinic, so it is the one
    // path that can recreate Riverside in a default state nobody wants.
    // open_signup is the 2026-09-04b twin of the activation trap below: without
    // it the demo clinic comes back invite-only, its /join link refuses
    // everyone, and the QR on the dashboard disappears mid-demo.
    //
    // activated_at is set explicitly: since 2026-08-26 a clinic is CLOSED until a
    // platform admin switches it on, and a demo clinic that cannot accept a join
    // or a check-in is not a demo. This is the one place a clinic is created
    // outside provision_clinic, so it is the one place that must remember.
    const { rows: [clinic] } = await db.query(
      // ⚠️ open_signup is FALSE. This script inserts the clinic directly rather
      // than through provision_clinic, so it is the one path that can recreate
      // the demo in a state nobody wants. It had to be taught activated_at for
      // that reason on 2026-08-26 and open_signup on 2026-09-04; on 2026-09-05
      // walk-in sign-up was removed from the product, so true here would put
      // Riverside back into a state the UI can no longer even show.
      'insert into public.clinics (name, slug, activated_at, open_signup) values ($1, $2, now(), false) returning id',
      [CLINIC.name, CLINIC.slug],
    );
    console.log(`Clinic: ${CLINIC.name} (${clinic.id})`);

    // 2. Manager (David) + therapist
    const managerSub = await createCognitoUser(MANAGER_EMAIL);
    await db.query('insert into public.users (id, email) values ($1, $2)', [managerSub, MANAGER_EMAIL]);
    await db.query(
      "insert into public.profiles (id, clinic_id, role, full_name) values ($1, $2, 'manager', $3)",
      [managerSub, clinic.id, 'David Peterson'],
    );

    const therapistSub = await createCognitoUser(alias('samtorres'));
    await db.query('insert into public.users (id, email) values ($1, $2)', [therapistSub, alias('samtorres')]);
    await db.query(
      "insert into public.profiles (id, clinic_id, role, full_name) values ($1, $2, 'therapist', $3)",
      [therapistSub, clinic.id, 'Sam Torres'],
    );
    console.log('Manager (David) + therapist (Sam Torres) ready.');

    // 3. Patients + check-ins (all assigned to the one therapist so the caseload view has content)
    for (const [name, checkins, email] of PATIENTS) {
      const sub = await createCognitoUser(email);
      await db.query('insert into public.users (id, email) values ($1, $2)', [sub, email]);
      await db.query(
        "insert into public.profiles (id, clinic_id, role, full_name, therapist_id) values ($1, $2, 'patient', $3, $4)",
        [sub, clinic.id, name, therapistSub],
      );
      // A consent row, like the real join flow writes.
      await db.query(
        "insert into public.consents (user_id, clinic_id, type, version) values ($1, $2, 'hipaa_patient_ack', 'v1')",
        [sub, clinic.id],
      );
      for (let i = 0; i < checkins.length; i++) {
        const c = checkins[i];
        await db.query(
          `insert into public.checkins (user_id, clinic_id, feeling, feeling_word, movements, note, ai_response, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            sub, clinic.id, c.feeling, FEELING_WORDS[c.feeling],
            MOVES[i % MOVES.length], NOTES[i % NOTES.length],
            'You showed up today — and that matters.', atDaysAgo(c.ago),
          ],
        );
      }
      console.log(`  ${name}: ${checkins.length} check-ins`);
    }

    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  }
}

async function main() {
  await db.connect();
  try {
    await resetDemo();
    await seedDemo();
    await restorePlatformAdmins();
    console.log(`\nDone. Riverside PT is pristine.`);
    console.log(`  Manager sign-in:  ${MANAGER_EMAIL}`);
    console.log(`  Showcase patient: ${alias('grace')} (log in AS Grace for the Progress screen)`);
    console.log(`  Join link:        https://glowpt.app/join/${CLINIC.slug}  (never share publicly)`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
