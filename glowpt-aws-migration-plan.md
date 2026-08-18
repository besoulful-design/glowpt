# GlowPT → AWS: Migration Plan

**For Claude Code · July 17, 2026**

**Read first, in order:** `glowpt-supabase-inventory.md`, `glowpt-aws-decisions-and-task-1.md`, `glowpt-task-1-findings.md`. This plan assumes all three and does not repeat them.

---

## Status

Task 1 is closed. The schema is settled and nothing is blocked.

- **Postgres 17.6**, matches the RDS target. No version gap.
- **6 tables**, no views, no sequences, no enums, no blocking extensions.
- **`movements` is `text[]`.** Not jsonb.
- **Five FKs into `auth.users`**, not four. `checkins.user_id` carries the fifth.
- **Cron:** jobid 2, `0 12 * * 1`, POST, empty body, 30000ms timeout.
- **RLS enabled on all six tables. `FORCE` off on all six.** See Rule 3.
- **`anon` and `authenticated` hold all seven privileges on all six tables.** Supabase's default. RLS is the only thing standing.
- **`bypassrls` roles are Supabase's own only:** `postgres`, `service_role`, `supabase_admin`, `supabase_etl_admin`, `supabase_read_only_user`. Nothing rogue.
- The leaked service key is rotated and deleted.

**The schema is closed for investigation. Do not re-dump, do not re-introspect.** Between Task 1's catalog pass and the four follow-up queries, we have tables, columns, constraints, indexes, triggers, policies, functions, sequences, enums, extensions, views, RLS state, grants, and bypass roles. The residual unknowns are object comments and default privileges, neither of which survives a fresh RDS build anyway.

---

## The two holes, restated, because they are the reason this plan exists

**Hole 1 — `profiles_update_self` (Observation 10.2).** Confidentiality. The policy restricts which row you may update, not which columns, and the grants are table-wide with nothing narrowing them. Any authenticated user sets their own `role = 'manager'` and `clinic_id = <any clinic uuid>`, then reads every patient name and free-text note in that clinic.

**Hole 2 — three orphan policies on `checkins` (Task 1).** Integrity. `Allow anonymous inserts for testing` is `with check (true)` granted `to public`. Permissive policies OR together, so it subsumes every other INSERT policy. Anyone holding the publishable key from the public bundle can write a `checkins` row with any `user_id` and any `clinic_id`. `0004`'s clinic backstop has been doing nothing since it shipped.

Together: hole 2 gets you write, hole 1 gets you read. Fabricated check-ins with free-text notes land in a real patient's record and a therapist reads them and acts on them.

Both are demo-data-only today. Neither survives into RDS.

**Why this is stated here rather than in a backlog:** the RLS port is not transcription. It is the highest-value work in this migration, and the plan is sequenced so it happens with a clear head rather than at hour eleven of day thirteen.

---

## Standing rules

The ten in `glowpt-aws-decisions-and-task-1.md` still hold. These four are new or upgraded, and rules 1 to 3 are the ones that cause silent, total authorization failure if they are wrong. Nothing errors. Everything looks fine.

### Rule 1 — `set_config(..., true)`, transaction-scoped, always

Unchanged from Q2 and still the single most important mechanical detail. RDS Proxy multiplexes connections across invocations. A session-level `set` can survive into another user's request, which is a cross-tenant PHI read. The value comes from a verified Cognito JWT. Never from a body, a header, or a path.

### Rule 2 — the Lambda connects as a dedicated non-owner role

Not the RDS master user. The master user owns the tables, and **an owner is exempt from RLS unless FORCE is set.** Point a Lambda at the database as master and every policy in this plan is silently ignored. No error, tests pass, app works, RLS does nothing.

Create `glowpt_app`, grant it explicit per-table privileges, and let it own nothing.

### Rule 3 — `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on all six

The live database has `relforcerowsecurity = false` everywhere. That is safe on Supabase only because the app connects as `anon`/`authenticated`, which are not owners. On RDS it is a trap.

FORCE is the backstop for the day something runs as owner by accident. Set it on all six. Admin work then has to set `app.user_id` too, or use a deliberate bypass role. That friction is the point.

**Together, rules 2 and 3 are an upgrade, not a port.** Supabase gave you one line of defense: RLS, with grants wide open behind it. On AWS you own the roles, so you get two. Grants *and* policies. Same code, better posture, no extra cost.

### Rule 4 — the helper functions must stay SECURITY DEFINER, and their owner matters

`auth_role()` and `auth_clinic_id()` read `profiles`. Policies **on `profiles`** call them. That is a recursion unless the function runs as an owner that is exempt from RLS.

On Supabase this worked invisibly. Under Rule 3, FORCE removes the owner's exemption, and it will remove it for these functions too.

**First task in Phase 1: read the three helper bodies out of `0000_baseline.sql` and confirm whether they are SECURITY DEFINER, and what they are owned by.** Then design the target so they still resolve without recursion and without becoming a bypass. `SET row_security = off` scoped inside a SECURITY DEFINER function owned by a role that is not `glowpt_app` is the usual shape. Get this wrong in the permissive direction and Rule 3 is decorative.

**Do not guess. Read the bodies and report what you find before writing the target schema.**

---

## Decisions Code asked for and did not get

### `0000_baseline.sql` is frozen. Do not edit it.

Task 1 recommended editing `0000` to drop the orphan policies and promoting it to sole schema-of-record. **Overruled, for one reason:** `0000` is the only honest record of what this database actually was on the day two security defects were found in it.

A risk analysis is being written. "Here is exactly what the system was, here is what we found, here is what we did" is credible. It stops being credible when the evidence has been edited to no longer contain the finding. Nothing happened here, it is demo data, and that is precisely why the habit is cheap to get right now.

**So:**

- `supabase/migrations/0000_baseline.sql` — frozen. Historical record. Never edited, never replayed.
- `supabase/migrations/0001` through `0004` — frozen. History. Never replayed.
- `db/schema.sql` — **new file, the single schema-of-record for AWS.** Written fresh against `public.users` and `current_user_id()`. The three orphan policies simply never appear in it. `profiles_update_self` is redesigned, not transcribed.

The Supabase migration directory becomes an archive. Nothing replays it, ever.

### `access_log` fire-and-forget (Observation 10.7) — fix it in the port

The audit write at `Dashboard.jsx:169` is not awaited and has no error handling. If it fails, staff see the roster and nothing records the view. It is a HIPAA audit control failing silently, which is the same shape as every other bug in this codebase's history.

In the target: the roster endpoint writes the audit row **in the same transaction as the read**. If the audit write fails, the read fails. That is the correct trade for an audit control and it is free, because the Lambda is already opening a transaction to set `app.user_id`.

### `view_patient` logging — David's call, not yours

`access_log.target_user_id` exists and `0001:63` names the action, but nothing logs it. There is no patient-detail route today, so nothing to log yet. Build the table and the enum ready for it. Do not invent the policy.

---

## Open questions for David, needed before Phase 4

**What is actually inside the weekly summary email?**

`weekly-summary` reads `profiles` (full names) and `checkins`. If the email body contains patient names, **that email is PHI in transit**, and the SES TLS policy stops being hygiene and becomes the control that matters.

Ask before rewriting it. Three shapes, descending risk:

1. Names and check-in detail in the body → PHI email. SES config set with TLS policy `Require`, non-negotiable.
2. Counts and aggregates only ("11 of 14 patients checked in") → arguably not PHI, still send it over required TLS.
3. Content-free nudge, detail behind an authenticated link → the safest design and the one worth arguing for.

Regardless of the answer: **SES configuration set with TLS policy `Require`.** SES does not require TLS by default and does not validate the receiving certificate. Set it in Phase 0 and never think about it again.

---

## Phases

Serial by necessity. The frontend cannot be rewritten until the API exists, and the API cannot exist until auth does. Do not parallelize past a phase boundary hoping to catch up.

### Phase 0 — Foundation

David's, mostly. Do not start until he confirms the org and BAA are done.

- AWS Organization, BAA accepted at the org root, GlowPT in its own member account
- Region: `us-east-1`
- Terraform or CDK from the first resource. **Not console clicking.** Under HIPAA the configuration is the documentation.
- VPC, private subnets, security groups
- **RDS Postgres 17.6, encryption at rest enabled at creation.** Cannot be added later without a snapshot-and-restore.
- `rds.force_ssl = 1`. Encryption in transit is not optional and the parameter group is where it lives.
- RDS Proxy. Required, not an optimization.
- Automated backups, retention set deliberately. This is the HIPAA contingency plan requirement (164.308(a)(7)), not a nice-to-have. Write down the retention and why.
- NAT gateway or VPC endpoints, decided on purpose. `ai-response` needs egress to `api.anthropic.com`. This is the difference between a $60 bill and a $110 one.
- SES: production access requested (roughly 24h, gates all sending), configuration set with **TLS policy `Require`**
- CloudTrail to S3, six-year lifecycle policy, per 164.316(b)(2)(i)

### Phase 1 — Schema

**The most important phase. Do not rush it and do not start it tired.**

1. Read the three helper function bodies from `0000_baseline.sql`. Report SECURITY DEFINER status and ownership. **Stop and report before continuing.**
2. Write `db/schema.sql` fresh:
   - `public.users(id uuid pk, email citext unique not null, created_at timestamptz default now())`
   - All five FKs repointed from `auth.users` to `public.users`. ON DELETE rules carry over unchanged, CASCADE included. Deleting a user still erases their check-ins, which is the behavior you want for a HIPAA delete.
   - `current_user_id()` replacing `auth.uid()`
   - Helpers redesigned per Rule 4
   - All 17 policies ported
   - **The three orphan `checkins` policies do not appear**
   - **`profiles_update_self` redesigned, not transcribed.** The codebase already has the right pattern: every other privileged write goes through a SECURITY DEFINER function that pins `role` and `clinic_id` server-side. `accept_staff_invite` even carries a comment at `0002:49` saying the client never chooses its own role. That intent is correct. Follow it. Note that `auth.jsx:72` and `auth.jsx:84` depend on patients writing their own profile row, so the policy cannot simply be dropped. **Design this with David before implementing.**
   - `consents_select_clinic` narrowed to caseload, consistent with `profiles` and `checkins` (Q4)
   - The `checkins` reality from Task 1, preserved rather than idealized: `user_id` is nullable, `created_at` is nullable with a `timezone('utc', now())` default, `id` defaults to `gen_random_uuid()`. Migration `0001` claims a NOT NULL on `created_at` that never took effect. Do not inherit the claim. **If you want to tighten these, propose it as a change, do not smuggle it in as a port.**
   - `FORCE ROW LEVEL SECURITY` on all six
   - `glowpt_app` role with explicit per-table grants. No table-wide grant-everything. This is where Supabase's default posture gets left behind on purpose.
3. Optional but cheap: a unique index on `(user_id, date(created_at))` closes the duplicate-check-in race at the database level rather than hoping the app wins it. Propose it, do not assume it.

**Test the two holes explicitly.** Write a test that tries the 10.2 self-promotion chain and a test that tries an anonymous `checkins` insert. Both must fail. These are the two things this migration exists to fix; prove they are fixed rather than believing they are.

### Phase 2 — Auth

- Cognito user pool, Essentials tier, passwordless email OTP. Choice-based sign-in, `ALLOW_USER_AUTH`. Custom SDK integration, not the hosted UI, which always requires passwords.
- Post-confirmation Lambda writes `public.users`, and carries the `handle_new_user` logic that currently lives in the `on_auth_user_created` trigger on `auth.users`. That trigger cannot come with you; its function body is in `0000_baseline.sql`.
- **Behavior gap to design around:** Supabase's `signInWithOtp` auto-creates a user if none exists. Cognito needs an explicit `SignUp`. Today `/login` creates an account for any email. Decide with David whether that behavior is intended before reproducing it.
- Signup metadata (`full_name`, `clinic_slug`, `consent_version`, `onboard_clinic_name`, `onboard_clinic_slug`) currently rides on `signInWithOtp`'s `data` option. Map to Cognito attributes or pass to the post-confirmation Lambda.

### Phase 3 — API

37 runtime call sites. 23 simple, 14 complex.

- Every Lambda opens a transaction, `set_config('app.user_id', <sub from verified JWT>, true)`, does its work, commits. **Every one. No exceptions.**
- The six RPCs port as-is. Their authorization is already server-side Postgres and it is genuinely well built: each re-derives the caller's clinic and role rather than trusting a parameter. Do not rewrite them into Lambda logic. That would be a downgrade.
- **`/join/:slug` needs an unauthenticated route.** There is no `anon` role on AWS. This is the only unauthenticated data read in the app and it is deliberate: a patient with no account has to resolve a clinic. Narrow it to the slug lookup rather than reproducing `USING (true)` on the whole table. It is also step 1 of the 10.2 chain, and while `clinics` holds no PHI, `select id, name, slug from clinics` is your entire customer list, readable by anyone.
- **No identifier in any URL path or query string.** Not a uuid, not an email, not a check-in id. The app has this property today by accident, because no patient-detail route exists. Preserve it deliberately. Both Netlify's CDN and API Gateway log paths.
- The roster endpoint writes its `access_log` row in the same transaction as the read.
- An API Gateway authorizer proves who is calling. It does not decide which rows they see. **RLS is the boundary.**

### Phase 4 — Functions

**`ai-response`:** needs a real authorizer. Supabase's gateway `verify_jwt` did this for free and the function consequently has no opinion of its own: it never reads the Authorization header, accepts any `{ prompt }`, and bills David's Anthropic account. API Gateway has no equivalent default. It also needs to stop being CORS `*`. Needs VPC egress to `api.anthropic.com`.

**`weekly-summary`:** rewrite for SES and EventBridge together. Do not port and then fix.

- EventBridge: `cron(0 12 ? * MON *)`. Lambda timeout 30s, matching the current `timeout_milliseconds`.
- The pg_cron row and its plaintext key stop existing. That is the actual fix for the incident that happened tonight.
- **Scope queries per clinic.** Today it reads every profile and every check-in across all clinics under the service role, with RLS off, and separates them with a JavaScript array filter at `:112`. One filter bug sends one clinic's data to another clinic's staff, with no database backstop. This is the one place where "port it as-is" carries real consequence.
- Fold in the known fixes: batch send, fail loudly, assert `sent === queued`. Do not do this twice on two email providers.
- The two stale defaults (`onboarding@resend.dev`, the Netlify app URL) go away.
- `.auth.admin.listUsers()` has no AWS equivalent. Emails come from `public.users` now, which is one of the reasons Q1 went the way it did.

**This is the deferrable phase.** It runs Mondays at noon. If two weeks gets tight, this is what slips, and nobody notices for six days.

### Phase 5 — Frontend

- `supabase-js` out, fetch against API Gateway in.
- `movements` is `text[]`. `node-postgres` maps a JS array natively. Confirmed, unambiguous.
- Session handling: Cognito tokens, not Supabase's. Decide storage deliberately.
- Netlify stays. It only ships the bundle and PHI never transits it. **The rule that keeps this true: the moment a Netlify Function exists, Netlify becomes a business associate and needs a BAA.** `netlify.toml:4` declares an empty functions directory; consider deleting it so nobody infers otherwise.
- Frontend BA surface is currently zero third-party scripts. Keep it there. Anything with a `<script>` tag on a PHI page is a business associate.

### Phase 6 — Cutover

No data migration. Demo data only. Rebuild demo clinics on the new stack with rewritten seed scripts.

**Do not tear down the Supabase project until the new stack is verified.** It is the rollback, it costs $25/month, and it is the only place the old database exists.

---

## Out of scope

- Rotating the old Anthropic key (David's, in progress)
- Deleting `.env.backup` and `.env.save` (ask first)
- `view_patient` audit logging (David's call)
- Any Clarity, marketing site, or FranklinAI work. **Different repo. Do not touch `franklinai-v2`.**

---

## The honest read on two weeks

The numbers are small: 37 call sites, 6 tables, no storage, no realtime, one auth flow that maps natively, six RPCs that port as-is.

The risk is not volume. It is that Phases 1 and 2 are the auth and access-control layer of a PHI application, and three of the four rules above fail **silently** when they are wrong. Nothing errors. Tests pass. RLS does nothing.

If the date gets tight, in order: **weekly-summary slips first** (it runs weekly, nobody notices for six days). Then the demo seed scripts. Then the date itself, which is David's own and promised to nobody.

**What does not slip: Phase 1.** Everything this migration is for lives there.
