# GlowPT → AWS: Decisions and Task 1

**For Claude Code · July 17, 2026**
**Companion to `glowpt-supabase-inventory.md`, which you produced. Read that first if it isn't in context.**

---

## What's happening

GlowPT is leaving Supabase for AWS. Decided, not under discussion.

**Why:** Supabase Team is $599/month and HIPAA is a paid add-on on top, Team-or-Enterprise only, starting around $350/month. Roughly $950/month before compute. GlowPT sells for $350/month per clinic. The product does not clear its own infrastructure cost until clinic four. The AWS equivalent is roughly $60 to $120/month with a free, self-serve BAA covering RDS, Cognito, Lambda, and SES under one agreement.

**Why now:** no real PHI exists yet. Demo clinics only. This is a schema migration today and a PHI data migration the moment a real patient logs in. The window is open and it closes on its own.

**Target:** real patients in roughly two weeks. That date is David's own and is not promised to any clinic, so it can move if the facts say so.

**The inventory says this is tractable:** 37 runtime call sites (23 simple, 14 complex), 6 tables, zero storage buckets, zero realtime subscriptions, one auth flow, zero third-party frontend scripts. Six RPCs already hold their authorization logic in Postgres and port with the schema.

---

## The seven questions, answered

These are David's decisions. They are settled. Build to them.

### Q1. What replaces `auth.users`? → An app-owned `users` table. Option (a).

Create `public.users(id uuid primary key, email citext unique not null, created_at timestamptz default now())`. A Cognito post-confirmation Lambda writes the row, using the Cognito `sub` as `id`.

All four foreign keys stay intact. `accept_staff_invite`'s `select email from auth.users` becomes `select email from public.users` and ports nearly unchanged.

**The deciding reason, beyond preserving the SQL:** it makes the database self-contained. The inventory found that this repo currently cannot rebuild its own database from empty. Option (b) would preserve that defect by leaving identity permanently outside the schema. Option (a) fixes it.

### Q2. How is `auth.uid()` reimplemented? → Transaction-scoped `set_config`. This is the one non-negotiable rule.

Replace `auth.uid()` with a helper reading a per-request setting, set from the **verified** Cognito token inside the transaction:

```sql
create or replace function public.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
```

**The rule, and it is absolute:**

> Use `set_config('app.user_id', <sub>, true)` inside the transaction. **Never** a session-level `set`.

RDS Proxy multiplexes connections across Lambda invocations. A session-scoped variable can survive into another user's request. That is a cross-tenant PHI read. All 17 policies depend on this being right, every time, with no exceptions.

The value must come from a verified JWT. Never from a request body, a header the client controls, or a path parameter.

### Q3. What about the pg_cron job? → EventBridge plus Lambda.

`weekly-summary` is triggered by a `cron.job` row in Postgres, which is not in the repo and which contains a service role key in plaintext. It becomes an EventBridge schedule invoking a Lambda. The plaintext key stops existing, which is a real improvement rather than a lateral move.

The cron definition must be read out of the live database before the Supabase project is torn down. It is in Task 1 below.

### Q4. Is `consents_select_clinic` granting therapists clinic-wide read intentional? → No. Make it consistent.

It was an oversight. `0002` narrowed `profiles` and `checkins` to a therapist's own caseload and did not touch `consents`. Bring `consents` in line with the caseload model when the policies are ported.

### Q5. Does the two-week scope include the 10.2 fix and the `weekly-summary` rewrite? → Yes to both, inside the migration.

**10.2 (`profiles_update_self` privilege escalation)** is the most important item in the whole project. Do not port that policy as written. See Standing Rules below.

**`weekly-summary`** is being rewritten for SES anyway. Fold in the known fixes at the same time rather than doing them twice on two email providers.

### Q6. Rotate the Anthropic key? → Yes. David is handling it separately.

It was `VITE_`-prefixed and therefore inlined into a public bundle in an earlier build. Out of scope for you. Do delete `.env.backup` and `.env.save` when you next touch that area, and ask before doing it.

### Q7. Is `movements` `text[]` or `jsonb`? → Unknown. That is Task 1.

---

## Task 1: get the baseline schema. This is the only task right now.

Everything downstream is blocked on this. The inventory established that `checkins`, the core PHI table, **has no `create table` anywhere in the repo**. There is no `0000` baseline. The only source of truth for the schema is the live Supabase database.

### 1. Install the Postgres client if it isn't there

```
pg_dump --version
```

Needs to be 15 or higher; 17 is safest. Supabase rejects dumps from older clients with a server version mismatch. If missing or old:

```
brew install libpq && echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

Then re-check the version. This is the step that failed for David: `zsh: command not found: pg_dump`.

### 2. Get the connection string from David

**Ask him for it. Do not go looking for it.** It's in the Supabase dashboard under **Connect**, and he needs the **Session pooler** URI on port **5432**. Not the Transaction pooler on 6543, which `pg_dump` cannot use and which fails confusingly.

**Do not write the connection string into any file, and do not echo it back.** It contains the database password.

### 3. Dump it into the repo

```
cd ~/Downloads/glowpt && mkdir -p supabase/migrations
pg_dump --schema-only --no-owner --no-acl --schema=public "<CONNECTION_STRING>" > supabase/migrations/0000_baseline.sql
```

`--schema=public` keeps Supabase's internal `auth`, `storage`, `realtime`, and `vault` schemas out. An FK from `checkins.user_id` into `auth.users` will still appear if it exists, because the constraint is declared on our table.

### 4. Report these facts, and only these facts

- The full `checkins` DDL.
- **Is `movements` `text[]` or `jsonb`?** The client passes a raw JS array either way and the two behave differently. This is a real fork in the client rewrite.
- **Does `checkins.user_id` have a foreign key to `auth.users`?** If yes, that is a fifth broken constraint on top of the four already known, and it feeds directly into Q1.
- Any table, column, index, constraint, trigger, or function in the dump that the inventory did not already know about.
- Whether `0000_baseline.sql` plus the existing `0001` through `0004` can now rebuild the database from empty, or whether they conflict. They probably conflict, since `0001` runs `alter table ... add column if not exists` against columns the dump will already contain. **Report the conflict. Do not resolve it yet.**

### 5. The cron job, separately

This is a query, not a dump. Ask David to run it in the Supabase SQL Editor:

```sql
select jobid, schedule, jobname, command from cron.job;
```

**The `command` field contains a service role key in plaintext.** He saves it somewhere sensible himself. It does not go in the repo, in this document, or in your context. You need the schedule and the shape of the command, not the key.

### 6. Commit

```
cd ~/Downloads/glowpt && git add . && git commit -m "Add 0000 baseline schema dump from live Supabase" && git push
```

Safe to commit: schema only, no rows, no keys, no PHI. Worth committing because it closes the defect where the repo cannot rebuild its own database.

---

## Standing rules for the migration

These outlive Task 1. They apply to every later piece of work.

1. **`set_config(..., true)`, transaction-scoped, always.** See Q2. If one rule survives from this document, it is this one.
2. **Do not port `profiles_update_self` as written.** It restricts which row you may update but not which columns, which lets any authenticated user set their own `role` to `manager` and their own `clinic_id` to any clinic uuid, then read every patient name and every free-text note in a clinic they have no relationship with. The fix follows the pattern the codebase already uses everywhere else: route the write through a SECURITY DEFINER function that pins `role` and `clinic_id` server-side, exactly as `accept_staff_invite` does. `auth.jsx:72` and `auth.jsx:84` depend on patients writing their own profile row, so the policy cannot simply be dropped. Design it with David before implementing.
3. **RLS is the authorization boundary, not the API Gateway authorizer.** An authorizer proves who is calling. It does not decide which rows they may see. Every table keeps RLS on. No exceptions, no "the Lambda checks it."
4. **No identifier ever appears in a URL path or query string.** Not a user uuid, not an email, not a check-in id. Netlify's CDN and API Gateway both log paths. The app has this property today by accident, because no patient-detail route exists. Preserve it on purpose. Select by the token's subject, server-side.
5. **`ai-response` needs a real authorizer.** Supabase's gateway did this for free and the function has no opinion of its own. API Gateway has no equivalent default. It also needs to stop being CORS `*`.
6. **`weekly-summary` must scope its queries per clinic** rather than reading every profile and every check-in across all clinics and separating them with a JavaScript array filter. Today one filter bug sends one clinic's data to another clinic's staff, with no database backstop.
7. **Infrastructure as code, Terraform or CDK, not console clicking.** Under HIPAA the configuration is the documentation. When a clinic's attorney asks how encryption and access control are enforced, a repo answers. A screenshot doesn't.
8. **RDS encryption at rest must be enabled at creation.** It cannot be added later without a snapshot-and-restore.
9. **RDS Proxy is required, not an optimization.** Lambda plus Postgres exhausts connections without it.
10. **No em dashes in any output.**

---

## Out of scope right now

Do not start any of this. Task 1 only.

- Provisioning any AWS resource
- Writing Terraform or CDK
- Writing Lambdas or API Gateway routes
- Touching Cognito
- Rewriting any application file
- Fixing 10.2, or anything else in the inventory's observations
- Deleting `.env.backup` or `.env.save`

The migration plan gets written after Task 1 reports back, because it gets written against the real schema rather than a guess about it.

---

## Things David is doing in parallel, so you don't duplicate them

- AWS Organization set up, BAA accepted at the org root
- SES production access requested (roughly 24 hours, gates all sending)
- Anthropic API organization BAA
- Rotating the old Anthropic key
- Documented risk analysis
- BAAs with Todd's and Haley's clinics
