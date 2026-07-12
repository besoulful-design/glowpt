# GlowPT — Project Guide (for Claude Code)
*Living doc. Loaded automatically every session when working in this folder. Updated 2026-07-12.*

## What it is
A daily wellness check-in app for physical therapy patients. Patient does a 30-second check-in (feeling 1–5, movement, a note) and gets a warm, AI-written reflection. Their clinic gets dashboards + a weekly summary. **Clinics subscribe; patients use it free** as a value-add.

- **Tagline:** One good day at a time.
- **Live app:** https://glowpt-app.netlify.app
- **Sits under the FranklinAI umbrella** (David Peterson's company; sibling product: ArmCare). GlowPT keeps its own amber/navy sunrise brand in patient-facing surfaces.

## How to work with David (IMPORTANT)
- David is newer to Claude Code and prefers to **go slow and have each step explained in plain, non-technical language before it happens.** Confirm before big/irreversible actions.
- **Edit files directly**, then show a clear summary + the single `git push` command. Don't hand him raw terminal commands to run unless necessary.
- **Keep the code split** into multiple files (router + `screens/` + `lib/` + `auth.jsx`) — do NOT collapse back into one giant `App.jsx`.
- **Read the current source files before editing them.** David deploys via `git push`; the files on disk are the source of truth.
- Never commit secrets. All `.env*` files are gitignored.

## Tech stack
| Layer | Tool |
|---|---|
| Frontend | React 19 + Vite |
| Routing | react-router-dom |
| Database + Auth | Supabase (magic-link passwordless) |
| Hosting / deploy | Netlify (auto-deploys on push to `main`) |
| AI reflections | Anthropic Claude (Haiku) via a **Supabase Edge Function** |
| Email | Resend (weekly summaries; scheduled via Supabase Cron/pg_cron) |
| Version control | GitHub — `besoulful-design/glowpt` |

## Key locations
| Thing | Path |
|---|---|
| Router | `src/App.jsx` |
| Entry / providers | `src/main.jsx` |
| Auth + profile context | `src/auth.jsx` |
| Patient app | `src/screens/PatientApp.jsx` |
| Clinic dashboard (manager/therapist) | `src/screens/Dashboard.jsx` |
| Patient join | `src/screens/Join.jsx` · Login `src/screens/Login.jsx` · Onboard `src/screens/Onboard.jsx` |
| Dashboard data logic | `src/lib/clinicData.js` |
| DB migration | `supabase/migrations/0001_multitenant.sql` |
| Edge functions | `supabase/functions/ai-response/` · `supabase/functions/weekly-summary/` |
| Demo seed / reset | `scripts/seed-demo.mjs` · `scripts/reset-demo.mjs` |
| Env (local, gitignored) | `.env` |

## Architecture (V2)
- **Multi-tenant:** tables `clinics`, `profiles` (role: `patient` | `therapist` | `manager`), `checkins` (keyed on existing `user_id` + `clinic_id`), `consents`, `access_log`. Row-Level Security keeps each clinic private.
- **Auth:** Supabase magic link. Patients join via `/join/<clinic-slug>`. Name/clinic/consent are stored in the signup **user_metadata** so they survive the link opening in any browser/app. Supabase "Confirm email" is OFF (the magic-link click IS the verification).
- **AI:** patient text goes to the `ai-response` Edge Function (keeps PHI inside Supabase — HIPAA-*ready*).
- **Dashboards:** manager = clinic-wide engagement; therapist = caseload; both show streaks, 7-day trend, and flags (Inactive 5+ days / Low-mood 2+ low days). Staff views write an `access_log` entry.
- **Weekly emails (PHI-free nudges):** `weekly-summary` Edge Function computes numbers in Supabase and sends via Resend. Patient email = own name + check-in count + link; clinic email = aggregates only, no names. Scheduled: Supabase Cron `weekly_summary`, `0 12 * * 1` (Mon 8am ET).

## Environment variables
- **Netlify (build):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (= Supabase **publishable** key `sb_publishable_…`). Anthropic keys were removed (AI moved to the Edge Function).
- **Supabase Edge Function secrets:** `ANTHROPIC_API_KEY` (GlowPT workspace key), `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`. (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to functions.)
- Supabase project URL: `https://iuefzbsgzsgsvybiurzd.supabase.co`

## Business model
- Clinic is the customer; patients free. Price ~**$300/mo** blended (planning range $250–$350; the live marketing site shows $350 — reconcile). Year-1 target: **29–40 clinics → $100–140K ARR** ($120K goal).
- Why clinics pay: patients drift off before finishing their plan of care (65–70% industry dropout); GlowPT keeps them engaged between visits → completed care → clinic stays full.
- **Positioning:** GlowPT is NOT an HEP/exercise-program tool (clinics resist those). Its wedge is the daily emotional/adherence check-in no other clinic tool owns. Target buyers: clinic owners + office/practice managers (often on Instagram, not LinkedIn).

## HIPAA guardrail (do not violate)
Patient check-ins are PHI. **Build and demo with DEMO DATA ONLY until a paying/committed clinic + signed BAAs.** Go-live flips (gated on first paying clinic): Supabase Team plan (~$599/mo) + Supabase BAA + Anthropic BAA. Also needs the `access_log` (done) before a real clinic dashboard. David + friends testing on the sandbox = demo data, not real PHI — that's fine.

## Demo vs sandbox convention
- **Riverside PT** = the clean **sales demo** clinic (David = manager, 5 seeded patients). Never share its `/join` link; re-pristine anytime with `scripts/reset-demo.mjs`.
- **Sandbox clinic** (e.g. "GlowPT Test") = for David + friends to dogfood daily; created self-serve via `/onboard`. Mess is fine.

## Status & backlog
- **✅ V2 shipped & live** (2026-07-12): auth, multi-clinic, patient app + AI, dashboards, onboarding + BAA, consent + audit log, weekly emails scheduled, PWA install.
- **Before real patients:** verify a GlowPT sender domain in Resend (so patient emails deliver); point Supabase auth emails at Resend (rate limits); do the HIPAA go-live flips above.
- **Backlog / future:** owner/super-admin console (see ALL clinics + MRR in one place); roster remove/**discharge** (soft-delete, pairs with post-discharge mode); Stripe subscriptions + billing; **beyond-PT** expansion (chiropractic, mental health, chronic care, coaching, general wellness).
