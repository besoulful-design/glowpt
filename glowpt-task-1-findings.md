# GlowPT Task 1: Baseline Schema Findings

**For claude.ai. Produced by Claude Code, July 17, 2026.**
**Companion to `glowpt-supabase-inventory.md` and `glowpt-aws-decisions-and-task-1.md`.**

---

## Method note (read first, it changes one assumption)

David chose the no-install path, so this was **not** produced by `pg_dump`. `pg_dump` was not installable on his Mac without his admin password (Homebrew is not present, `/usr/local/bin` is not writable, sudo needs a password). Instead I connected to the live database over the Session pooler (port 5432) with a pure-JavaScript Postgres client and introspected the catalog directly, using the same `pg_get_*def` functions that `pg_dump` itself uses for constraints, indexes, triggers, and functions.

**What this means for trust:** the DDL for tables, constraints, indexes, functions, and policies is catalog-exact. What a real `pg_dump` would add on top is mostly cosmetic (object comments, default privileges, sequence ownership) and none of it applies here (there are no sequences, no comments, no custom grants). **The one place introspection could in principle miss an "unknown unknown" is an object type I did not think to query for.** I queried tables, columns, constraints, indexes, triggers, policies, functions, sequences, enums/domains, and extensions. If you want belt-and-suspenders certainty before tearing down Supabase, a real `pg_dump` from any machine that has it is worth one final pass. My assessment is that it would find nothing new, but I am flagging the residual risk honestly rather than claiming pg_dump-equivalence.

The generated file is at **`supabase/migrations/0000_baseline.sql`** (296 lines, public schema only, no rows, no secrets). It is ordered extensions then tables then functions then policies so it can replay top to bottom, which raw catalog order does not guarantee.

---

## The answers Task 1 asked for

**Server:** PostgreSQL **17.6**. (Good news for the RDS target: same major version is available, so no version-gap surprises.)

**Q7, settled: `movements` is `text[]`.** Not `jsonb`. The client at `PatientApp.jsx:234` passes a JS array and it lands in a Postgres text array. On the AWS side the driver has to map a JS array to a Postgres `text[]` parameter, which `node-postgres` does natively. This is a real detail for the client rewrite and it is now unambiguous.

**`checkins.user_id` foreign key to `auth.users`: YES. It exists.** This is the fifth broken constraint, on top of the four the inventory already knew about. Verbatim:

```
checkins_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
```

So the full set of foreign keys pointing at `auth.users`, all of which break when `auth.users` stops existing on RDS, is now **five**:

| Table | Constraint | Rule |
|---|---|---|
| `profiles` | `profiles_id_fkey` (id) | ON DELETE CASCADE |
| `checkins` | `checkins_user_id_fkey` (user_id) | ON DELETE CASCADE |
| `consents` | `consents_user_id_fkey` (user_id) | ON DELETE CASCADE |
| `access_log` | `access_log_actor_id_fkey` (actor_id) | ON DELETE CASCADE |
| `staff_invites` | `staff_invites_invited_by_fkey` (invited_by) | ON DELETE SET NULL |

This feeds straight into Q1 (the app-owned `public.users` table). With Q1's decision, all five of these repoint from `auth.users` to `public.users` and the ON DELETE rules carry over unchanged. The `checkins` one being CASCADE matters: deleting a user still erases their check-ins, which is the behavior you want for a HIPAA delete.

**The full `checkins` DDL, as it actually exists in the live database:**

```sql
create table public.checkins (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  feeling integer not null,
  feeling_word text,
  movements text[],
  note text,
  ai_response text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  other_movement text,
  clinic_id uuid
);
alter table public.checkins add constraint checkins_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
alter table public.checkins add constraint checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.checkins add constraint checkins_pkey PRIMARY KEY (id);
CREATE INDEX checkins_clinic_idx ON public.checkins USING btree (clinic_id, created_at DESC);
CREATE INDEX checkins_user_idx ON public.checkins USING btree (user_id, created_at DESC);
```

Note three things the migration files do not tell you, because `checkins` predates them and `add column if not exists` silently no-oped:

1. **`user_id` is nullable.** No NOT NULL constraint. The RLS policies are what enforce `user_id = auth.uid()` on write, not the column. On RDS this stays true: do not assume a NOT NULL you do not have.
2. **`created_at` is nullable and its default is `timezone('utc'::text, now())`**, not `now() not null`. Migration `0001` claims `add column if not exists created_at timestamptz not null default now()`, but that line **never took effect** because the column already existed. The live column is the older, nullable, UTC-defaulted version. This is a concrete example of the repo describing a column it does not actually control.
3. **`id` default is `gen_random_uuid()`** (from `pgcrypto`), not `uuid_generate_v4()`. Both extensions are installed; the table uses the pgcrypto one.

---

## New finding not in the inventory: three orphan RLS policies on `checkins`

**This is the most important thing this task surfaced, and it is exactly why reading the live database mattered rather than trusting the migration files.**

The inventory reconstructed the RLS model from the migration files. The live `checkins` table carries **three additional policies that appear in no migration and were invisible to the inventory.** They are V1-era leftovers from before the multi-tenant rebuild. The migrations only ever ran `drop policy if exists` against their own new policy names, so these old-named policies were never removed and are still live:

```sql
create policy "Allow anonymous inserts for testing" on public.checkins
  for insert to public with check (true);
create policy "Users can insert their own checkins" on public.checkins
  for insert to public with check ((auth.uid() = user_id));
create policy "Users can view their own checkins" on public.checkins
  for select to public using ((auth.uid() = user_id));
```

**Why the first one is serious.** Postgres combines permissive policies for the same command with OR. For INSERT on `checkins`, the effective rule is the OR of every INSERT policy present:

- `Allow anonymous inserts for testing`: **`true`**, granted **`to public`** (which includes `anon`)
- `Users can insert their own checkins`: `auth.uid() = user_id`, to public
- `checkins_insert_own`: `user_id = auth.uid() AND clinic_id = auth_clinic_id()`, to authenticated

Because the first policy is `true` for `public`, it **subsumes all the others**. The careful clinic-scoping backstop that migration `0004` was written to enforce (a check-in must belong to the author's clinic) is **currently defeated**: anyone, including an unauthenticated caller holding only the publishable key, can insert a `checkins` row with any `user_id` and any `clinic_id`, or none. The inventory's Observation 10.2 (the `profiles_update_self` self-promotion path) described one hole in the RLS model; this is a second, independent one, and this one does not even require an account.

**Impact today:** demo data only, so no PHI is exposed. This is a latent defect, not an active incident. But it means two things for the plan:

1. **The inventory's RLS section understated the live attack surface.** The security model as-built is not the security model as-documented. Whoever ports the policies must port from **this baseline**, not from `0001` through `0004`, or these three will either be silently dropped (fine) or, worse, faithfully recreated (not fine).
2. **These three must not be carried to RDS.** The porting rule is: recreate the four `checkins_*` policies and the `profiles`/`consents`/`access_log`/`staff_invites` policies, and **drop the three quoted above on the floor.** They have no place in the target model.

Reported, not fixed, per the standing instruction. Flagging it as a peer of Observation 10.2 in severity: it is arguably worse, because it needs no authentication.

Every other table (`profiles`, `clinics`, `consents`, `access_log`, `staff_invites`) matches the inventory exactly. No orphan policies anywhere but `checkins`.

---

## Everything else in the dump, cross-checked against the inventory

- **Tables (6):** `access_log`, `checkins`, `clinics`, `consents`, `profiles`, `staff_invites`. No unknown tables. Matches inventory.
- **Functions (10):** `accept_staff_invite`, `assign_therapist`, `auth_clinic_id`, `auth_role`, `discharge_patient`, `handle_new_user`, `invite_staff`, `is_my_patient`, `provision_clinic`, `restore_patient`. All ten present, all captured verbatim in the baseline. Matches inventory.
- **Sequences:** none. Every primary key is a `uuid`, so there is no serial/identity sequence to migrate. One less thing.
- **Enums / domains:** none in `public`.
- **Extensions installed (matters for the RDS port):**
  | Extension | Schema | On RDS? |
  |---|---|---|
  | `pgcrypto` | extensions | Yes. Used for `gen_random_uuid()`. |
  | `uuid-ossp` | extensions | Yes. Installed but the table default uses pgcrypto, so possibly removable. |
  | `pg_cron` | pg_catalog | Yes on RDS, but the plan (Q3) moves scheduling to EventBridge, so it is not needed on the target. |
  | `pg_net` | extensions | **Not on RDS.** Only used by the Supabase cron to make the HTTP call. Goes away with the EventBridge move. |
  | `pg_stat_statements` | extensions | Yes. Observability, harmless. |
  | `supabase_vault` | vault | **Supabase-only.** Not used by any GlowPT object in `public`. Does not port and does not need to. |
  | `plpgsql` | pg_catalog | Built in everywhere. |

  The only two that do not exist on stock RDS are `pg_net` and `supabase_vault`, and neither is used by application code once scheduling moves to EventBridge. **No extension blocks the migration.**

- **The `on_auth_user_created` trigger is NOT in this baseline, by design.** It lives on `auth.users`, which is outside the `public` schema, so a public-only dump correctly excludes it. The inventory (6.4) and the plan (Q1) already account for it: it is the only thing that creates a profile row, and it becomes a Cognito post-confirmation step. Its function body (`handle_new_user`) **is** captured in the baseline, so the logic is preserved for whoever rebuilds it. Just be aware the trigger wiring itself is not in the file because it cannot be.

---

## Can `0000` + `0001` through `0004` rebuild the database from empty?

**On stock/empty Postgres: no.** Two hard blockers, both expected:

1. Every `auth.users` foreign key (all five) fails, because `auth.users` does not exist. This is the Q1 work, not a defect in the dump.
2. Policies and functions reference `auth.uid()`, which is a Supabase-provided function in the `auth` schema. Absent on stock Postgres. This is the Q2 work.

So the baseline is a faithful record of the **Supabase-hosted** database, not a portable-anywhere script. That is correct and expected; making it portable is literally what Q1 and Q2 are for.

**Do `0000` and `0001`-`0004` conflict with each other?** Mostly no, but they are redundant, and there is one real conflict to know about:

- `0001` uses `create table if not exists` for its tables and `add column if not exists` for the `checkins` columns. Against a database that already has `0000` applied, every one of these no-ops cleanly. No error.
- `0001`-`0004` create functions with `create or replace` and (re)create policies with `drop policy if exists` first. All idempotent. Replaying them on top of `0000` re-creates identical objects without error.
- **The redundancy:** `0000` already contains the fully-migrated, post-`0004` state (it is a dump of the live DB, which has all four migrations applied). So `0000` then `0001`-`0004` **applies everything twice.** It will not error, but it is not a clean history. `0000` is a snapshot, not a starting point that `0001`-`0004` build upon.
- **The one genuine conflict:** `0000` recreates the three orphan `checkins` policies (because they are live and got introspected). `0001`-`0004` never drop them (that is why they survived in the first place). So a `0000`-then-`0001`-`0004` replay **preserves the anonymous-insert hole.** Another reason those three should be deleted from `0000` by hand before it is used as the migration baseline, or `0000` should become the sole schema-of-record and `0001`-`0004` retired to history.

**Recommendation (not applied, flagging for your decision):** the clean end state is that `0000_baseline.sql`, edited to drop the three orphan policies and rewritten for the AWS identity model (Q1/Q2), becomes the **single** schema-of-record, and `0001` through `0004` are kept only as historical record, not as a replay chain. But per the standing rule I did not resolve this. Reporting it.

---

## Still needed from David: the cron job (Task 1, step 5)

This is a query, not part of the dump, and it holds a service-role key in plaintext so it must not come near the repo or my context. David needs to run this himself in the Supabase SQL Editor and save the result somewhere safe:

```sql
select jobid, schedule, jobname, command from cron.job;
```

We need the **schedule** and the **shape of the command** (which URL it calls, which headers). We do **not** need the key inside it. Once David has that saved, the EventBridge rebuild (Q3) can be specced against it. Until it is read out, it is the one piece of migration surface still living only in the Supabase database.

---

## Bottom line for the plan

- The two headline unknowns are resolved: `movements` is `text[]`, and `checkins.user_id` **does** carry the fifth `auth.users` foreign key.
- The schema is small, clean, and holds no surprises in its shape. No unknown tables, no sequences, no blocking extensions, no enums.
- The one real surprise is a **security** surprise, not a structural one: three orphan RLS policies on `checkins`, including an unauthenticated `insert ... with check (true)` that currently defeats the `0004` clinic backstop. It changes nothing about the two-week timeline, but it must be in front of whoever writes the RLS port, and it argues (with Observation 10.2) that the RLS rewrite deserves real care rather than a transcribe-and-move.
- The baseline is committed. The repo can now describe its own `checkins` table for the first time.
