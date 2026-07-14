# GlowPT — Project Guide (for Claude Code)
*Living doc. Loaded automatically every session when working in this folder. Updated 2026-07-13.*

## What it is
A daily wellness check-in app for physical therapy patients. Patient does a 30-second check-in (feeling 1–5, movement, a note) and gets a warm, AI-written reflection. Their clinic gets dashboards + a weekly summary. **Clinics subscribe; patients use it free** as a value-add.

- **Tagline:** One good day at a time.
- **Live app:** https://glowpt-app.netlify.app
- **Sits under the FranklinAI umbrella** (David Peterson's company; sibling product: ArmCare). GlowPT keeps its own amber/navy sunrise brand in patient-facing surfaces.

## How to work with David (IMPORTANT)
- David is newer to Claude Code and prefers to **go slow and have each step explained in plain, non-technical language before it happens.** Confirm before big/irreversible actions.
- **Edit files directly, then run `git push` yourself** (confirmed preference — don't hand him the command). Show a clear plain-language summary of what changed.
- **Supabase/SQL steps:** lead with 1–2 plain-English sentences (what it does + reassurance like "nothing gets deleted"), THEN give the SQL block for David to paste & **Run** in the Supabase **SQL Editor** himself. Do NOT just dump a migration file with a terse "paste and run." (He briefly chose "Claude runs SQL via the Chrome extension," but that isn't connected — Chrome + the Claude-in-Chrome extension would be needed; revisit if set up.)
- **Scripts needing the service-role/secret key** (`seed-demo.mjs` / `reset-demo.mjs`) are David's to run locally — he has the Supabase **secret key** (`sb_secret_…`, the new service_role replacement). Never ask him to paste that key into chat/screenshots.
- **Keep the code split** into multiple files (router + `screens/` + `lib/` + `auth.jsx`) — do NOT collapse back into one giant `App.jsx`.
- **Read the current source files before editing them.** David deploys via `git push`; the files on disk are the source of truth.
- Never commit secrets. All `.env*` files are gitignored.

## Tech stack
| Layer | Tool |
|---|---|
| Frontend | React 19 + Vite |
| Routing | react-router-dom |
| Database + Auth | Supabase (passwordless — 6-digit email OTP code) |
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
| DB migrations | `supabase/migrations/0001_multitenant.sql` · `0002_therapists.sql` (staff invites + caseload RLS) |
| Edge functions | `supabase/functions/ai-response/` · `supabase/functions/weekly-summary/` |
| Demo seed / reset | `scripts/seed-demo.mjs` · `scripts/reset-demo.mjs` |
| Env (local, gitignored) | `.env` |

## Architecture (V2)
- **Multi-tenant:** tables `clinics`, `profiles` (role: `patient` | `therapist` | `manager`; patients carry `therapist_id` = assigned PT), `checkins` (keyed on existing `user_id` + `clinic_id`), `consents`, `access_log`, `staff_invites`. Row-Level Security keeps each clinic private.
- **Staff invites (V2.1):** a manager invites a therapist by email (`invite_staff` RPC → `staff_invites` row); the therapist becomes staff on first sign-in (`accept_staff_invite` RPC, called from `loadProfile`) — role is set server-side so a patient can't self-promote. Manager assigns patients to therapists (`assign_therapist` RPC). Migration `supabase/migrations/0002_therapists.sql`.
- **Auth:** Supabase passwordless **6-digit email code** (OTP). Flow = `signInWithOtp` → user types the code into the same tab → `verifyOtp` (shared `CodeVerify` screen used by Login/Join/Onboard). Chosen over magic links because links open in whatever email app, breaking session persistence on phones; the code keeps everything in one tab. **Requires the Supabase "Magic Link" + "Confirm sign up" email templates to include `{{ .Token }}`.** Name/clinic/consent ride in signup **user_metadata** AND a localStorage backup saved by the form. **Gotcha (fixed 2026-07-13):** `signInWithOtp` `data`/user_metadata is only written for a BRAND-NEW email — ignored for an already-existing account. So `loadProfile` also falls back to the localStorage backup (incl. the name) — rely on that, not metadata alone, or a returning email's name/clinic goes blank. "Confirm email" is OFF. CodeVerify checks `getSession()` after `verifyOtp` and forwards into the app on success (an error only shows if truly not signed in).
- **AI:** patient text goes to the `ai-response` Edge Function (keeps PHI inside Supabase — HIPAA-*ready*).
- **Patient app (`PatientApp.jsx`):** welcome → daily check-in → AI reflection → **Progress screen** ("View my progress", built 2026-07-13). Progress is a stack of cards: consecutive-day **streak** (hero) → This-week + all-time counts → **"Your month"** card (avg-mood summary + 4 weekly-average bars showing the arc) → tappable **"This week"** card to read past entries. One 30-day `checkins` query powers week + trend + streak; all-time total via a count query. (Earlier it reused the post-checkin screen + showed 30 anonymous dots — both replaced.)
- **Dashboards:** manager = clinic-wide engagement + care-team management (invite therapists, assign patients); therapist = ONLY their assigned caseload (enforced by RLS, not just UI). Both show streaks, 7-day trend, and flags (Inactive 5+ days / Low-mood 2+ low days). Staff views write an `access_log` entry. **7-day trend shows the same emoji faces the patient taps at check-in** (not colored dots, as of 2026-07-14) — patient/manager/therapist share one language; triage is carried by the Status pills, not color. The 1–5 face + word scale (😔 Really tough → 😄 Feeling great) lives in ONE shared file `src/lib/feelings.js`, imported by both `PatientApp.jsx` and `Dashboard.jsx` so they can't drift. (Patient Progress-screen month bars still color by mood via a local `FEELING_COLOR` in `PatientApp.jsx`.)
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
- **Riverside PT** = the clean **sales demo** clinic (David = manager via `besoulful@gmail.com`; **6 seeded patients** incl. showcase **Grace Bennett** = `dwpeterson15+grace@gmail.com`, ~25 check-ins over 30 days trending up with a 14-day streak — log in AS her to demo the patient **Progress screen**). Never share its `/join` link; re-pristine with `scripts/reset-demo.mjs`.
- **Sandbox = "Ridge PT"** (created via `/onboard`, manager `dwpeterson15@gmail.com`) = for David + friends to dogfood. Test logins (Gmail `+aliases` → all land in his inbox): therapist `dwpeterson15+therapist1@gmail.com` ("Dr. Sam"), patients `dwpeterson15+patient1@gmail.com` (Tim Long, assigned to Dr. Sam) & `dwpeterson15+test@gmail.com` ("Davey"). Mess is fine.
- **Login-code emails use Supabase's built-in rate-limited mailer (~few/hr)** — heavy same-day testing can exhaust it; codes then don't arrive (check spam, wait, or do the custom-SMTP work).

## Status & backlog
- **✅ V2.2 (2026-07-14):** dashboard readability pass. 7-day trend switched from colored dots to the patient's own emoji faces + words (shared `src/lib/feelings.js`); legend wording matches the patient app; faces sit in equal 20px slots so they never overflow. Roster columns pinned to fixed widths so header + rows align (Streak/Avg/Status centered). **Avg cell leads with the rounded-average mood face** (e.g. 🙂 2.8) so the 1–5 scale reads at a glance. QR card compact on phone (text beside the code). Landing hero reworded → "A daily check-in to keep patients engaged between visits." Cross-checked all auth/landing screens for role-appropriate language (Landing = clinic-first w/ patient escape hatch; Onboard = clinic; Join = new patient; Login/CodeVerify = neutral) — all coherent; Landing & Onboard kept separate on purpose (pitch vs sign-up form).
- **✅ V2 shipped & live** (2026-07-12): auth, multi-clinic, patient app + AI, dashboards, onboarding + BAA, consent + audit log, weekly emails scheduled, PWA install.
- **✅ V2.1 (2026-07-13):** therapist **caseloads** (manager invites + assigns; RLS-scoped); patient **Progress screen** (streak + monthly trend); staff/patient greet-by-name; **bug fixes** — OTP "code didn't work" false error + no-forward-after-login; `/join` "Link not found" for logged-out patients (RLS now allows `anon` SELECT on `clinics`); reliable name capture at setup (localStorage fallback); iPhone-portrait dashboard fit (roster scrolls sideways); Good/Great dot colors distinct.
- **Before real patients (bundle in one session):** David is buying the **`glowpt.app`** domain (.com taken). Then: verify it in **Resend** (DNS) + point Supabase Auth at Resend via **custom SMTP** (fixes both the "Supabase Auth" sender name patients see AND the rate limit). Then HIPAA go-live flips above. **When the domain changes**, also update: Netlify custom domain, Edge-function `APP_URL` secret, and the **hardcoded `glowpt-app.netlify.app/join/…` string shown on the Onboard page** (`Onboard.jsx`, ~line 85).
- **⭐ Owner/super-admin dashboard (David flagged as a near-term want, 2026-07-14):** a private view for David across ALL clinics — who's signed up, engagement, MRR later — to manage/track the business. Independent of the domain/email work, can be built anytime. **HIPAA note:** keep it to clinic-level aggregates + billing, NOT patient PHI across clinics, to stay clean.
- **Backlog / future:** **"Invite therapist" should send the therapist a real invite email** (today it only creates a pending row — they must go to `/login` themselves; fold into the SMTP/email work); roster remove/**discharge** (soft-delete); Stripe subscriptions + billing; **beyond-PT** expansion (chiropractic, mental/behavioral health, chronic care, coaching, wellness — note "PT" can also read as *Physical Transformation*).
