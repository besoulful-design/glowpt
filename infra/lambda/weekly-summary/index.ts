import { Signer } from '@aws-sdk/rds-signer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Client } from 'pg';

/**
 * GlowPT weekly-summary Lambda (AWS rewrite of the old Supabase edge function).
 *
 * Fires from EventBridge every Monday at 08:00 America/New_York. It reads the
 * whole mailing list in one cross-clinic query (weekly_summary_rows(), a
 * SECURITY DEFINER function callable ONLY by the dedicated glowpt_weekly role)
 * and sends two PHI-minimised email types via SES:
 *   - patient -> their OWN first name + 7-day check-in count + a link. No
 *               feelings, notes, or anyone else's data.
 *   - clinic  -> aggregate numbers only (engagement %, # needing attention). No
 *               patient names.
 * The per-clinic scoping and aggregates are computed in SQL, never in JS, so the
 * Lambda cannot mix two clinics' data (the old code's one array filter was the
 * cross-tenant risk).
 *
 * Reaches the proxy as glowpt_weekly over IAM auth (no stored DB password), and
 * reaches the SES API over an interface VPC endpoint (the Lambda has no NAT).
 *
 * Two known bugs from the old function are fixed here:
 *   1. Silent partial send. The old loop reported success even when 1 of 13
 *      dropped. This asserts sent === queued and THROWS on a mismatch, so a
 *      partial send fails the invocation loudly (visible in CloudWatch / metrics).
 *   2. Rate-limit drops. Sends are throttled well under SES's 14/sec cap.
 *
 * Invoke with { "dryRun": true } to compute + count the outbox without sending.
 *
 * Environment:
 *   DB_PROXY_ENDPOINT  RDS Proxy hostname (never the DB directly)
 *   DB_USER            glowpt_weekly
 *   DB_NAME            glowpt
 *   DB_PORT            5432
 *   SES_CONFIG_SET     glowpt-transactional (TLS Require)
 *   SES_FROM           From header, e.g. "GlowPT <no-reply@glowpt.app>"
 *   APP_URL            https://glowpt.app
 *   AWS_REGION         provided by the Lambda runtime
 */

const {
  DB_PROXY_ENDPOINT = '',
  DB_USER = 'glowpt_weekly',
  DB_NAME = 'glowpt',
  DB_PORT = '5432',
  SES_CONFIG_SET = 'glowpt-transactional',
  SES_FROM = 'GlowPT <no-reply@glowpt.app>',
  APP_URL = 'https://glowpt.app',
  AWS_REGION = 'us-east-1',
} = process.env;

const PORT = Number(DB_PORT);

// Reused across warm invocations. getAuthToken() mints a fresh short-lived IAM
// token per call from the function's execution role; signing is local.
const signer = new Signer({
  hostname: DB_PROXY_ENDPOINT,
  port: PORT,
  username: DB_USER,
  region: AWS_REGION,
});

const ses = new SESv2Client({ region: AWS_REGION });

// Stay comfortably under SES's 14/sec: send in small groups, pause between them.
const SEND_CHUNK = 10;
const CHUNK_PAUSE_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Email copy, preserved VERBATIM from the old Supabase function so the
// ---- patient/clinic voice does not change. Only APP_URL/FROM differ (SES).
const firstName = (n: string | null) => (n || 'there').trim().split(' ')[0];

function shell(inner: string) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;background:#0d1825;color:#f5efe4;padding:32px;border-radius:8px;max-width:480px;margin:auto">
    <div style="font-size:26px;font-weight:600;margin-bottom:18px">Glow<span style="color:#c8861d">PT</span></div>
    ${inner}
  </div>`;
}

function patientEmail(name: string, count: number) {
  const line =
    count > 0
      ? `You checked in <strong>${count}</strong> ${count === 1 ? 'day' : 'days'} last week. 🌅`
      : `A fresh week is here — a good time to check back in. 🌅`;
  return shell(`
    <p style="font-size:17px;line-height:1.5">Hi ${name},</p>
    <p style="font-size:16px;line-height:1.6;color:rgba(245,239,228,0.8)">${line}</p>
    <p style="font-size:15px;line-height:1.6;color:rgba(245,239,228,0.6)">Open GlowPT to see your reflections and log today.</p>
    <a href="${APP_URL}" style="display:inline-block;margin-top:14px;background:#c8861d;color:#0d1825;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:4px">Open GlowPT →</a>
    <p style="font-size:13px;color:rgba(245,239,228,0.35);margin-top:22px">One good day at a time.</p>`);
}

function clinicEmail(
  clinicName: string,
  total: number,
  active: number,
  engagement: number,
  needAttention: number,
) {
  return shell(`
    <p style="font-size:17px;line-height:1.5">Your weekly GlowPT summary for <strong>${clinicName}</strong> is ready.</p>
    <div style="background:#1a2840;border:1px solid rgba(200,134,29,0.2);border-radius:6px;padding:16px;margin:14px 0">
      <p style="margin:0 0 8px;font-size:15px;color:rgba(245,239,228,0.8)"><strong>${active}</strong> of <strong>${total}</strong> patients checked in (${engagement}% engagement)</p>
      <p style="margin:0;font-size:15px;color:${needAttention ? '#e0a035' : 'rgba(245,239,228,0.8)'}"><strong>${needAttention}</strong> patient${needAttention === 1 ? '' : 's'} may need attention</p>
    </div>
    <p style="font-size:14px;line-height:1.6;color:rgba(245,239,228,0.6)">Log in to see who's engaged and who could use a nudge.</p>
    <a href="${APP_URL}/dashboard" style="display:inline-block;margin-top:12px;background:#c8861d;color:#0d1825;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:4px">Open dashboard →</a>`);
}

interface SummaryRow {
  clinic_id: string;
  clinic_name: string;
  recipient_id: string;
  email: string;
  full_name: string | null;
  role: 'patient' | 'manager' | 'therapist';
  checkin_days: number;
  clinic_total_patients: number;
  clinic_active_patients: number;
}

interface OutboxItem {
  to: string;
  subject: string;
  html: string;
  // recipient_id + role are logged (not the email) if a send fails, to keep
  // CloudWatch lean on PHI while still being debuggable.
  recipientId: string;
  role: string;
}

function buildOutbox(rows: SummaryRow[]): OutboxItem[] {
  const outbox: OutboxItem[] = [];
  for (const r of rows) {
    if (r.role === 'patient') {
      outbox.push({
        to: r.email,
        subject: 'Your GlowPT week 🌅',
        html: patientEmail(firstName(r.full_name), r.checkin_days),
        recipientId: r.recipient_id,
        role: r.role,
      });
    } else {
      // manager / therapist -> the clinic aggregate summary
      const total = r.clinic_total_patients;
      const active = r.clinic_active_patients;
      const engagement = total ? Math.round((active / total) * 100) : 0;
      const needAttention = total - active;
      outbox.push({
        to: r.email,
        subject: `GlowPT weekly summary — ${r.clinic_name}`,
        html: clinicEmail(r.clinic_name, total, active, engagement, needAttention),
        recipientId: r.recipient_id,
        role: r.role,
      });
    }
  }
  return outbox;
}

async function sendOne(m: OutboxItem): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM,
      Destination: { ToAddresses: [m.to] },
      Content: {
        Simple: {
          Subject: { Data: m.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: m.html, Charset: 'UTF-8' } },
        },
      },
      ConfigurationSetName: SES_CONFIG_SET,
    }),
  );
}

export const handler = async (
  event: { dryRun?: boolean } = {},
): Promise<{ ok: boolean; dryRun: boolean; queued: number; sent: number }> => {
  const dryRun = event?.dryRun === true;

  // ---- 1. Read the mailing list. Any failure here THROWS (fail loud): a broken
  // ---- read must never look like a quiet week (the old function's worst bug).
  const token = await signer.getAuthToken();
  const client = new Client({
    host: DB_PROXY_ENDPOINT,
    port: PORT,
    user: DB_USER,
    database: DB_NAME,
    password: token,
    // Proxy requires TLS. rejectUnauthorized false only because the RDS CA is
    // not pinned here yet (same TODO as the other Lambdas).
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    // query_timeout, NOT statement_timeout: RDS Proxy rejects the server option.
    query_timeout: 20000,
  });

  let rows: SummaryRow[];
  try {
    await client.connect();
    const res = await client.query<SummaryRow>('select * from weekly_summary_rows()');
    rows = res.rows;
  } finally {
    await client.end().catch(() => {
      /* ignore */
    });
  }

  const outbox = buildOutbox(rows);
  const queued = outbox.length;
  const patients = outbox.filter((m) => m.role === 'patient').length;
  const clinics = queued - patients;
  console.log(
    JSON.stringify({
      msg: 'weekly-summary computed',
      rows: rows.length,
      queued,
      patientEmails: patients,
      clinicEmails: clinics,
      dryRun,
    }),
  );

  if (dryRun) {
    return { ok: true, dryRun: true, queued, sent: 0 };
  }

  // ---- 2. Send, throttled under 14/sec. Collect every failure; do not stop.
  let sent = 0;
  const failures: { recipientId: string; role: string; error: string }[] = [];

  for (let i = 0; i < outbox.length; i += SEND_CHUNK) {
    const chunk = outbox.slice(i, i + SEND_CHUNK);
    const results = await Promise.allSettled(chunk.map(sendOne));
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        sent++;
      } else {
        const m = chunk[j];
        failures.push({
          recipientId: m.recipientId,
          role: m.role,
          error:
            result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    if (i + SEND_CHUNK < outbox.length) await sleep(CHUNK_PAUSE_MS);
  }

  // ---- 3. FAIL LOUD. A partial send must never report success (David's bar:
  // ---- "12/13 is not acceptable, I don't want any falling off").
  if (sent !== queued) {
    console.error(
      JSON.stringify({
        msg: 'weekly-summary PARTIAL SEND',
        queued,
        sent,
        failures,
      }),
    );
    throw new Error(`weekly-summary sent ${sent} of ${queued}; ${failures.length} failed`);
  }

  console.log(JSON.stringify({ msg: 'weekly-summary ok', queued, sent }));
  return { ok: true, dryRun: false, queued, sent };
};
