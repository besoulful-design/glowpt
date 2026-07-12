// GlowPT · Supabase Edge Function · weekly-summary
// Runs weekly. Computes engagement numbers INSIDE Supabase and sends PHI-free nudge
// emails via Resend. No patient health info ever leaves in an email:
//   • patient  → their own first name + check-in count + a link (no feelings/notes)
//   • clinic   → aggregate numbers only (engagement %, # needing attention), NO names
//
// Deploy:  supabase functions deploy weekly-summary
// Secrets: supabase secrets set RESEND_API_KEY=...  FROM_EMAIL="GlowPT <hello@yourdomain>"  APP_URL=https://glowpt-app.netlify.app
// Test:    invoke with ?dryRun=true to see what WOULD send without sending.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "GlowPT <onboarding@resend.dev>"
const APP_URL = Deno.env.get("APP_URL") ?? "https://glowpt-app.netlify.app"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
)

const firstName = (n: string | null) => (n || "there").trim().split(" ")[0]

async function sendEmail(to: string, subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  return r.ok
}

function shell(inner: string) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;background:#0d1825;color:#f5efe4;padding:32px;border-radius:8px;max-width:480px;margin:auto">
    <div style="font-size:26px;font-weight:600;margin-bottom:18px">Glow<span style="color:#c8861d">PT</span></div>
    ${inner}
  </div>`
}

function patientEmail(name: string, count: number) {
  const line = count > 0
    ? `You checked in <strong>${count}</strong> ${count === 1 ? "day" : "days"} last week. 🌅`
    : `A fresh week is here — a good time to check back in. 🌅`
  return shell(`
    <p style="font-size:17px;line-height:1.5">Hi ${name},</p>
    <p style="font-size:16px;line-height:1.6;color:rgba(245,239,228,0.8)">${line}</p>
    <p style="font-size:15px;line-height:1.6;color:rgba(245,239,228,0.6)">Open GlowPT to see your reflections and log today.</p>
    <a href="${APP_URL}" style="display:inline-block;margin-top:14px;background:#c8861d;color:#0d1825;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:4px">Open GlowPT →</a>
    <p style="font-size:13px;color:rgba(245,239,228,0.35);margin-top:22px">One good day at a time.</p>`)
}

function clinicEmail(clinicName: string, total: number, active: number, engagement: number, needAttention: number) {
  return shell(`
    <p style="font-size:17px;line-height:1.5">Your weekly GlowPT summary for <strong>${clinicName}</strong> is ready.</p>
    <div style="background:#1a2840;border:1px solid rgba(200,134,29,0.2);border-radius:6px;padding:16px;margin:14px 0">
      <p style="margin:0 0 8px;font-size:15px;color:rgba(245,239,228,0.8)"><strong>${active}</strong> of <strong>${total}</strong> patients checked in (${engagement}% engagement)</p>
      <p style="margin:0;font-size:15px;color:${needAttention ? "#e0a035" : "rgba(245,239,228,0.8)"}"><strong>${needAttention}</strong> patient${needAttention === 1 ? "" : "s"} may need attention</p>
    </div>
    <p style="font-size:14px;line-height:1.6;color:rgba(245,239,228,0.6)">Log in to see who's engaged and who could use a nudge.</p>
    <a href="${APP_URL}/dashboard" style="display:inline-block;margin-top:12px;background:#c8861d;color:#0d1825;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:4px">Open dashboard →</a>`)
}

Deno.serve(async (req) => {
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "true"
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

  try {
    const [{ data: clinics }, { data: profiles }, { data: checkins }, { data: userList }] = await Promise.all([
      supabase.from("clinics").select("id, name"),
      supabase.from("profiles").select("id, clinic_id, role, full_name"),
      supabase.from("checkins").select("user_id, created_at").gte("created_at", weekAgo),
      supabase.auth.admin.listUsers(),
    ])

    const emailById: Record<string, string> = {}
    for (const u of userList?.users ?? []) if (u.email) emailById[u.id] = u.email

    // count distinct check-in days per user this week
    const daysByUser: Record<string, Set<string>> = {}
    for (const c of checkins ?? []) {
      (daysByUser[c.user_id] ||= new Set()).add(new Date(c.created_at).toDateString())
    }
    const countFor = (id: string) => daysByUser[id]?.size ?? 0

    const outbox: { to: string; subject: string; html: string }[] = []

    for (const clinic of clinics ?? []) {
      const patients = (profiles ?? []).filter(p => p.clinic_id === clinic.id && p.role === "patient")
      const staff = (profiles ?? []).filter(p => p.clinic_id === clinic.id && (p.role === "manager" || p.role === "therapist"))

      // Patient nudges (their own data only)
      for (const p of patients) {
        const to = emailById[p.id]
        if (to) outbox.push({ to, subject: "Your GlowPT week 🌅", html: patientEmail(firstName(p.full_name), countFor(p.id)) })
      }

      // Clinic aggregates (no names)
      const total = patients.length
      const active = patients.filter(p => countFor(p.id) > 0).length
      const engagement = total ? Math.round((active / total) * 100) : 0
      const needAttention = patients.filter(p => countFor(p.id) === 0).length
      for (const st of staff) {
        const to = emailById[st.id]
        if (to) outbox.push({ to, subject: `GlowPT weekly summary — ${clinic.name}`, html: clinicEmail(clinic.name, total, active, engagement, needAttention) })
      }
    }

    let sent = 0
    if (!dryRun) for (const m of outbox) if (await sendEmail(m.to, m.subject, m.html)) sent++

    return new Response(JSON.stringify({ ok: true, dryRun, queued: outbox.length, sent }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("weekly-summary error:", err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    })
  }
})
