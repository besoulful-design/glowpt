# GlowPT Supabase Surface Inventory

**Produced by Claude Code, July 17, 2026.** Read-only pass over the repository at `/Users/mac/Downloads/glowpt`. No application file was created, modified, or deleted. This document is the only output.

Method: every file under `src/`, `supabase/`, `scripts/`, `netlify/`, plus root config, was read directly. Nothing below is inferred from folder names. Where the repository cannot answer a question, it says so rather than guessing. Open questions for claude.ai are collected in the last section.

---

## 1. Headline numbers

| Metric | Count | Notes |
|---|---|---|
| Total `supabase.*` call sites | **55** | Split below. The number that sizes the migration is the runtime one. |
| ... in frontend (`src/`) | **33** | Every one becomes an API Gateway route plus Lambda, or gets folded into a coarser endpoint. |
| ... in Edge Functions | **4** | All inside `weekly-summary`. |
| ... in dev scripts (`scripts/`) | **18** | `seed-demo.mjs` and `reset-demo.mjs`. Local tooling, not shipped. Rewrite or discard. |
| **Runtime call sites (frontend + Edge)** | **37** | This is the real estimate driver. |
| Distinct tables | **6** | `clinics`, `profiles`, `checkins`, `consents`, `access_log`, `staff_invites`. Plus `auth.users`, which is Supabase-owned and does not port. |
| RLS policies | **17** | All quoted verbatim in section 2. |
| Postgres functions | **10** | 6 called from the client via `.rpc()`, 3 policy helpers, 1 signup trigger. |
| **Distinct storage buckets** | **0** | Supabase Storage is not used anywhere. No `.upload(`, no `getPublicUrl`, no `createSignedUrl`. |
| **Realtime subscriptions** | **0** | **This is very good news. See section 5.** |
| Edge Functions | **2** | `ai-response`, `weekly-summary`. |
| Auth flows in use | **1** (plus admin API) | Passwordless 6-digit email OTP only. No password, no reset, no confirmed magic-link click, no OAuth. |
| Third-party scripts on PHI pages | **0** | No analytics, no error tracker, no tag manager. See section 9. |
| Netlify Functions | **0** | `netlify.toml` points at `netlify/functions`, which is an empty directory. |

**The two biggest unknowns in the plan both resolve in your favor.** Realtime is a clean zero, so nothing in the app depends on Supabase's websocket layer and there is no equivalent to rebuild on AWS. Storage is a clean zero, so there are no objects to move and no presigned-URL access pattern to design. The migration is a database, an auth system, 37 call sites, and 2 functions.

**One number is not in the repository and needs to be:** the base `checkins` table definition. See the first observation in section 10. It is the single thing most likely to cost you a day you did not plan for.

---

## 2. Tables and RLS

RLS is **enabled on all 6 tables**. There is no table with RLS off. All 6 tables are in the `public` schema.

Policy state below is the **final state after all four migrations**, since `0002` and `0004` drop and recreate several policies from `0001`. Where a policy was redefined, the superseded version is noted and the current one is the one quoted.

Every policy expression is quoted verbatim from the migration files.

### 2.1 `clinics`

One row per subscribing clinic. Holds name, slug, BAA signature timestamp and version. **No PHI.** Defined in `0001_multitenant.sql:9`.

| Policy | Command | Roles | Expression |
|---|---|---|---|
| `clinics_select` | SELECT | **`anon`, `authenticated`** | `USING (true)` |

Verbatim (`0001_multitenant.sql:113`):
```sql
create policy clinics_select on public.clinics for select to anon, authenticated using (true);
```

No INSERT, UPDATE, or DELETE policy exists. Clinic creation goes exclusively through the `provision_clinic` SECURITY DEFINER function.

Does not reference `auth.uid()`. The `anon` grant is deliberate and documented in the migration: a brand-new patient opening `/join/<slug>` has no account yet, so the clinic lookup runs unauthenticated. See observation 10.4 for the side effect.

### 2.2 `profiles`

Links each auth login to a clinic and a role. Columns: `id` (FK to `auth.users`), `clinic_id`, `role` (`patient` / `therapist` / `manager`), `full_name`, `therapist_id`, `discharged_at`, `created_at`. Defined in `0001_multitenant.sql:22`, extended by `0003_discharge.sql:17`.

**Holds PHI.** A row here is a named person plus the fact that they are a physical therapy patient at an identified clinic, plus their assigned therapist. That is individually identifiable health information on its own, before any check-in is read.

| Policy | Command | Roles | Expression | Refs `auth.uid()` |
|---|---|---|---|---|
| `profiles_select_self` | SELECT | authenticated | `USING (id = auth.uid())` | **Direct** |
| `profiles_select_clinic` | SELECT | authenticated | `USING (auth_role() = 'manager' and clinic_id = auth_clinic_id())` | Indirect (via helpers) |
| `profiles_select_caseload` | SELECT | authenticated | `USING (auth_role() = 'therapist' and therapist_id = auth.uid())` | **Direct** + indirect |
| `profiles_insert_self` | INSERT | authenticated | `WITH CHECK (id = auth.uid())` | **Direct** |
| `profiles_update_self` | UPDATE | authenticated | `USING (id = auth.uid())` `WITH CHECK (id = auth.uid())` | **Direct** |

Verbatim, current state:
```sql
-- 0001_multitenant.sql:117
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

-- 0002_therapists.sql:108  (supersedes the 0001 version, which also allowed 'therapist')
create policy profiles_select_clinic on public.profiles
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());

-- 0002_therapists.sql:112
create policy profiles_select_caseload on public.profiles
  for select to authenticated
  using (auth_role() = 'therapist' and therapist_id = auth.uid());

-- 0001_multitenant.sql:124
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- 0001_multitenant.sql:127
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
```

**`profiles_update_self` is the subject of observation 10.2 and it is the most serious thing in this document.** Read that before porting this table.

No DELETE policy.

### 2.3 `checkins`

The daily patient check-in: feeling score, feeling word, movements, free-text note, and the AI-written reflection. **This is the core PHI table.** The free-text `note` is patient-authored and unbounded.

**The base table is not defined anywhere in this repository.** `0001_multitenant.sql:37` only runs `alter table public.checkins add column if not exists ...` against a table that already existed before the migrations were written. The repo therefore defines only `clinic_id`, `other_movement`, and `created_at`. The columns the app actually reads and writes (`id`, `user_id`, `feeling`, `feeling_word`, `movements`, `note`, `ai_response`) exist only in the live database. See observation 10.1.

| Policy | Command | Roles | Expression | Refs `auth.uid()` |
|---|---|---|---|---|
| `checkins_insert_own` | INSERT | authenticated | `WITH CHECK (user_id = auth.uid() and clinic_id = auth_clinic_id())` | **Direct** + indirect |
| `checkins_select_own` | SELECT | authenticated | `USING (user_id = auth.uid())` | **Direct** |
| `checkins_select_clinic` | SELECT | authenticated | `USING (auth_role() = 'manager' and clinic_id = auth_clinic_id())` | Indirect |
| `checkins_select_caseload` | SELECT | authenticated | `USING (auth_role() = 'therapist' and clinic_id = auth_clinic_id() and public.is_my_patient(user_id))` | Indirect |
| `checkins_update_own` | UPDATE | authenticated | `USING (user_id = auth.uid())` `WITH CHECK (user_id = auth.uid() and clinic_id = auth_clinic_id())` | **Direct** + indirect |

Verbatim, current state:
```sql
-- 0004_require_clinic.sql:16  (supersedes 0001's version, which omitted the clinic_id check)
create policy checkins_insert_own on public.checkins
  for insert to authenticated
  with check (user_id = auth.uid() and clinic_id = auth_clinic_id());

-- 0001_multitenant.sql:135
create policy checkins_select_own on public.checkins
  for select to authenticated using (user_id = auth.uid());

-- 0002_therapists.sql:118  (supersedes the 0001 version, which also allowed 'therapist')
create policy checkins_select_clinic on public.checkins
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());

-- 0002_therapists.sql:122
create policy checkins_select_caseload on public.checkins
  for select to authenticated
  using (auth_role() = 'therapist' and clinic_id = auth_clinic_id() and public.is_my_patient(user_id));

-- 0004_require_clinic.sql:23  (supersedes 0003's version, which omitted the clinic_id check)
create policy checkins_update_own on public.checkins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and clinic_id = auth_clinic_id());
```

No DELETE policy. Patients and staff cannot delete check-ins through the API at all. Only the service role key (used by `reset-demo.mjs`) can.

### 2.4 `consents`

Patient HIPAA acknowledgment: who, when, which version. Defined in `0001_multitenant.sql:46`.

**Holds PHI** by the same logic as `profiles`: a row identifies a named user as a patient of an identified clinic.

| Policy | Command | Roles | Expression | Refs `auth.uid()` |
|---|---|---|---|---|
| `consents_insert_own` | INSERT | authenticated | `WITH CHECK (user_id = auth.uid())` | **Direct** |
| `consents_select_own` | SELECT | authenticated | `USING (user_id = auth.uid())` | **Direct** |
| `consents_select_clinic` | SELECT | authenticated | `USING (auth_role() in ('therapist','manager') and clinic_id = auth_clinic_id())` | Indirect |

Verbatim:
```sql
-- 0001_multitenant.sql:144
create policy consents_insert_own on public.consents
  for insert to authenticated with check (user_id = auth.uid());

-- 0001_multitenant.sql:147
create policy consents_select_own on public.consents
  for select to authenticated using (user_id = auth.uid());

-- 0001_multitenant.sql:150
create policy consents_select_clinic on public.consents
  for select to authenticated
  using (auth_role() in ('therapist','manager') and clinic_id = auth_clinic_id());
```

Note: `consents_select_clinic` still grants `therapist` clinic-wide read. `0002` narrowed the equivalent policies on `profiles` and `checkins` to a therapist's own caseload but did not touch `consents`. Whether that is intentional is unclear. See question Q4.

No UPDATE or DELETE policy.

### 2.5 `access_log`

Application-layer HIPAA audit trail recording staff views of patient data. Defined in `0001_multitenant.sql:60`.

**Holds PHI-adjacent data**: `target_user_id` plus `clinic_id` links a named patient to a clinic. Treat as PHI.

| Policy | Command | Roles | Expression | Refs `auth.uid()` |
|---|---|---|---|---|
| `access_log_insert_own` | INSERT | authenticated | `WITH CHECK (actor_id = auth.uid())` | **Direct** |
| `access_log_select_clinic` | SELECT | authenticated | `USING (auth_role() = 'manager' and clinic_id = auth_clinic_id())` | Indirect |

Verbatim:
```sql
-- 0001_multitenant.sql:156
create policy access_log_insert_own on public.access_log
  for insert to authenticated with check (actor_id = auth.uid());

-- 0001_multitenant.sql:159
create policy access_log_select_clinic on public.access_log
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());
```

No UPDATE or DELETE policy, which is correct for an audit log.

### 2.6 `staff_invites`

A manager invites a therapist or co-manager by email. Defined in `0002_therapists.sql:10`. Unique on `(clinic_id, email)`.

**Holds identifiable data** (staff name and email), but staff are workforce members, not patients. Not PHI.

| Policy | Command | Roles | Expression | Refs `auth.uid()` |
|---|---|---|---|---|
| `staff_invites_select_clinic` | SELECT | authenticated | `USING (auth_role() = 'manager' and clinic_id = auth_clinic_id())` | Indirect |

Verbatim:
```sql
-- 0002_therapists.sql:26
create policy staff_invites_select_clinic on public.staff_invites
  for select to authenticated using (auth_role() = 'manager' and clinic_id = auth_clinic_id());
```

No INSERT, UPDATE, or DELETE policy by design. All writes route through the `invite_staff` and `accept_staff_invite` SECURITY DEFINER functions. The migration says so explicitly at line 28.

### 2.7 Postgres functions

These are as load-bearing as the policies. Four of them read `auth.uid()`, and one reads `auth.users` directly. Every one is `SECURITY DEFINER` except where noted, meaning they bypass RLS by design and enforce their own authorization in the function body. **That authorization is real security, not application convenience, and it ports to AWS along with the policies.**

| Function | File:line | Kind | Reads `auth.uid()` | Reads `auth.users` | Purpose |
|---|---|---|---|---|---|
| `auth_clinic_id()` | `0001:73` | Helper, SECURITY DEFINER, stable | **Yes** | No | Returns caller's `clinic_id`. Used by 9 policies. |
| `auth_role()` | `0001:78` | Helper, SECURITY DEFINER, stable | **Yes** | No | Returns caller's role. Used by 8 policies. |
| `is_my_patient(uuid)` | `0002:100` | Helper, SECURITY DEFINER, stable | **Yes** | No | Caseload check. Used by `checkins_select_caseload`. |
| `provision_clinic(text,text)` | `0001:85` | RPC, SECURITY DEFINER | **Yes** | No | Creates a clinic, makes caller its manager. |
| `accept_staff_invite()` | `0002:50` | RPC, SECURITY DEFINER | **Yes** | **Yes** (`select email from auth.users where id = auth.uid()`) | Attaches an invited staff member on first sign-in. Sets role server-side. |
| `invite_staff(text,text,text)` | `0002:31` | RPC, SECURITY DEFINER | **Yes** | No | Manager creates an invite for their own clinic. |
| `assign_therapist(uuid,uuid)` | `0002:75` | RPC, SECURITY DEFINER | **Yes** | No | Manager assigns a patient to a therapist. |
| `discharge_patient(uuid)` | `0003:20` | RPC, SECURITY DEFINER | **Yes** | No | Manager soft-deletes a patient. |
| `restore_patient(uuid)` | `0003:36` | RPC, SECURITY DEFINER | **Yes** | No | Manager restores a discharged patient. |
| `handle_new_user()` | `0001:166` | **Trigger on `auth.users`**, SECURITY DEFINER | No | **Yes** (it is the trigger) | Auto-creates a bare profile on signup, reading `raw_user_meta_data->>'full_name'`. |

`handle_new_user` is attached as `on_auth_user_created after insert on auth.users` (`0001:176`). **This trigger cannot port.** `auth.users` is a Supabase-managed table that will not exist on RDS. See observation 10.3.

### 2.8 The `auth.uid()` surface, summarized

This is the identity injection the brief flags as needing rebuild.

- **10 policies reference `auth.uid()` directly**: `profiles_select_self`, `profiles_select_caseload`, `profiles_insert_self`, `profiles_update_self`, `checkins_insert_own`, `checkins_select_own`, `checkins_update_own`, `consents_insert_own`, `consents_select_own`, `access_log_insert_own`.
- **7 policies reference it indirectly** through `auth_role()` / `auth_clinic_id()` / `is_my_patient()`.
- **1 policy references no identity at all**: `clinics_select`.
- **9 functions call `auth.uid()`** in their bodies.

No policy uses `auth.jwt()` or `auth.role()` anywhere. The entire identity surface is `auth.uid()`, funnelled through three helper functions. **That is a fortunate shape.** If `auth.uid()` is reimplemented as a single function reading a per-transaction session variable that a Lambda sets from the verified Cognito token, the policy bodies port very close to as-is. The helpers mean most policies do not even mention it.

---

## 3. Every `supabase.*` call site

### 3.1 Classification rule used

The brief defines complex as "joins, RPC calls, transactions, chained filters, anything with `.rpc(`". Taken literally, "chained filters" would classify almost every call here as complex, since nearly all use `.eq()`. That would not be informative. **The rule actually applied, stated so it can be overridden:**

- **Simple**: single-table read or write, equality and range filters only, maps to one obvious SQL statement. Mechanical to port.
- **Complex**: `.rpc()`, `.functions.invoke()`, `auth.admin.*`, aggregate/count queries, or upsert with conflict resolution. Needs a design decision, not just transcription.

There are **no SQL joins anywhere in the client code** and **no client-side transactions**. Every multi-table operation is already inside a SECURITY DEFINER RPC, which is why the complex list is short and clean.

### 3.2 Frontend, `src/` (33 call sites)

**`src/supabase.js`** (client construction, not counted as a call site)

| Line | Call | Notes |
|---|---|---|
| 6 | `createClient(supabaseUrl, supabaseAnonKey)` | The single client instance. Every other frontend call imports this. |

**`src/auth.jsx`** (10)

| Line | Call | Target | Class |
|---|---|---|---|
| 36 | `.from('profiles').select(COLS).eq('id', userId).single()` | profiles | Simple |
| 70 | `.rpc('provision_clinic', { p_name, p_slug })` | RPC | **Complex** |
| 72 | `.from('profiles').update({ full_name }).eq('id', userId)` | profiles | Simple |
| 77 | `.rpc('accept_staff_invite')` | RPC | **Complex** |
| 82 | `.from('clinics').select('id').eq('slug', joinSlug).single()` | clinics | Simple |
| 84 | `.from('profiles').upsert({...}, { onConflict: 'id' })` | profiles | **Complex** (upsert) |
| 89 | `.from('consents').insert({...})` | consents | Simple |
| 99 | `.from('profiles').select(COLS).eq('id', userId).single()` | profiles | Simple |
| 112 | `.auth.onAuthStateChange(cb)` | Auth | **Complex** (session lifecycle) |
| 131 | `.auth.signOut()` | Auth | Simple |

**`src/lib/clinicData.js`** (8)

| Line | Call | Target | Class |
|---|---|---|---|
| 8 | `.from('profiles').select('id, full_name, created_at, therapist_id, discharged_at').eq('clinic_id', clinicId).eq('role', 'patient')` | profiles | Simple |
| 11 | `.from('checkins').select('user_id, feeling, feeling_word, note, created_at').eq('clinic_id', clinicId).order('created_at', desc)` | checkins | Simple |
| 21 | `.from('profiles').select('id, full_name').eq('clinic_id', clinicId).eq('role', 'therapist').order('full_name')` | profiles | Simple |
| 30 | `.from('staff_invites').select('email, full_name, role').eq('clinic_id', clinicId).is('consumed_at', null).order('created_at', desc)` | staff_invites | Simple |
| 39 | `.rpc('invite_staff', { p_email, p_full_name, p_role })` | RPC | **Complex** |
| 42 | `.rpc('assign_therapist', { p_patient, p_therapist })` | RPC | **Complex** |
| 46 | `.rpc('discharge_patient', { p_patient })` | RPC | **Complex** |
| 49 | `.rpc('restore_patient', { p_patient })` | RPC | **Complex** |

Note on lines 8 and 11: the roster is built by **two separate unfiltered-by-join reads, then stitched in JavaScript** (`buildRoster`, line 69). RLS does the scoping. This is the pattern that makes the migration easier than it looks, and also the pattern that makes RLS non-optional. See observation 10.5.

**`src/screens/PatientApp.jsx`** (6)

| Line | Call | Target | Class |
|---|---|---|---|
| 173 | `.from('checkins').select('feeling, feeling_word, movements, other_movement, note, ai_response, created_at').eq('user_id', user.id).gte('created_at', since).order('created_at', asc)` | checkins | Simple |
| 185 | `.from('checkins').select('*', { count: 'exact', head: true }).eq('user_id', user.id)` | checkins | **Complex** (count-only, `head: true`, no rows returned) |
| 221 | `.functions.invoke('ai-response', { body: { prompt } })` | Edge Function | **Complex** |
| 246 | `.from('checkins').select('id').eq('user_id', user.id).gte('created_at', dayStart).lt('created_at', dayEnd).order('created_at', asc).limit(1)` | checkins | Simple |
| 256 | `.from('checkins').update(payload).eq('id', existingId).select('id')` | checkins | Simple |
| 262 | `.from('checkins').insert(payload)` | checkins | Simple |

Lines 246, 256, and 262 are a **read-then-update-else-insert sequence with no transaction**. It is the same-day re-entry logic. See observation 10.6.

**`src/screens/Dashboard.jsx`** (2)

| Line | Call | Target | Class |
|---|---|---|---|
| 155 | `.from('clinics').select('id, name, slug').eq('id', profile.clinic_id).single()` | clinics | Simple |
| 169 | `.from('access_log').insert({ actor_id, action: 'view_roster', clinic_id })` | access_log | Simple |

Line 169 is **not awaited and has no error handling**. See observation 10.7.

**`src/screens/Onboard.jsx`** (2)

| Line | Call | Target | Class |
|---|---|---|---|
| 41 | `.auth.signInWithOtp({ email, options: { emailRedirectTo, data: { full_name, onboard_clinic_name, onboard_clinic_slug } } })` | Auth | **Complex** (carries signup metadata) |
| 63 | `.from('clinics').select('id').eq('slug', effectiveSlug).maybeSingle()` | clinics | Simple |

**`src/screens/Join.jsx`** (2)

| Line | Call | Target | Class |
|---|---|---|---|
| 25 | `.from('clinics').select('id, name, slug').eq('slug', slug).single()` | clinics | Simple. **Runs as `anon`.** The only unauthenticated data read in the app. |
| 31 | `.auth.signInWithOtp({ email, options: { emailRedirectTo, data: { full_name, clinic_slug, consent_version } } })` | Auth | **Complex** (carries signup metadata) |

**`src/screens/Login.jsx`** (1)

| Line | Call | Target | Class |
|---|---|---|---|
| 14 | `.auth.signInWithOtp({ email, options: { emailRedirectTo } })` | Auth | Simple |

**`src/screens/CodeVerify.jsx`** (2)

| Line | Call | Target | Class |
|---|---|---|---|
| 26 | `.auth.verifyOtp({ email, token, type: 'email' })` | Auth | **Complex** (the whole sign-in hinge) |
| 31 | `.auth.getSession()` | Auth | Simple |

### 3.3 Edge Functions (4 call sites)

**`supabase/functions/weekly-summary/index.ts`**

| Line | Call | Target | Class |
|---|---|---|---|
| 17 | `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` | Client init | Uses the **service role key**. Server-side only, correctly. |
| 69 | `.from("clinics").select("id, name")` | clinics | Simple |
| 70 | `.from("profiles").select("id, clinic_id, role, full_name")` | profiles | Simple. **Unscoped read of every profile in every clinic.** |
| 71 | `.from("checkins").select("user_id, created_at").gte("created_at", weekAgo)` | checkins | Simple. Unscoped across all clinics. |
| 72 | `.auth.admin.listUsers()` | Auth admin API | **Complex.** No AWS equivalent without a Cognito rewrite. |

All four run under the service role, so RLS does not apply. Cross-clinic separation here is enforced **only by the JavaScript filter on line 112** (`profiles.filter(p => p.clinic_id === clinic.id)`). See observation 10.5.

### 3.4 Dev scripts, `scripts/` (18 call sites)

Not shipped to users. Both require `SUPABASE_SERVICE_ROLE_KEY` from the environment and are run by David locally. Listed for completeness; the migration decision here is probably "rewrite against the new stack when demo data is next needed" rather than "port".

**`scripts/seed-demo.mjs`** (7)

| Line | Call | Target | Class |
|---|---|---|---|
| 18 | `createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })` | Init | Service role |
| 53 | `db.auth.admin.listUsers()` | Auth admin | **Complex** |
| 60 | `db.auth.admin.createUser({ email, email_confirm: true, user_metadata })` | Auth admin | **Complex** |
| 64 | `db.from('profiles').upsert(...)` | profiles | **Complex** (upsert) |
| 78 | `db.from('clinics').select('id').eq('slug', CLINIC.slug).maybeSingle()` | clinics | Simple |
| 80 | `db.from('clinics').insert(CLINIC).select('id').single()` | clinics | Simple |
| 97 | `db.from('checkins').delete().eq('user_id', user.id)` | checkins | Simple |
| 104 | `db.from('checkins').insert(rows)` | checkins | Simple |

**`scripts/reset-demo.mjs`** (11)

| Line | Call | Target | Class |
|---|---|---|---|
| 14 | `createClient(url, key, ...)` | Init | Service role |
| 51 | `db.auth.admin.listUsers({ page, perPage: 200 })` | Auth admin | **Complex** |
| 63 | `db.auth.admin.createUser({ ... })` | Auth admin | **Complex** |
| 67 | `db.from('profiles').upsert(...)` | profiles | **Complex** (upsert) |
| 79 | `db.from('clinics').select('id').eq('slug', ...).maybeSingle()` | clinics | Simple |
| 81 | `db.from('clinics').insert(CLINIC).select('id').single()` | clinics | Simple |
| 87 | `db.from('checkins').delete().eq('clinic_id', clinic.id)` | checkins | Simple |
| 91 | `db.from('profiles').select('id, role').eq('clinic_id', clinic.id)` | profiles | Simple |
| 99 | `db.auth.admin.deleteUser(p.id)` | Auth admin | **Complex** |
| 107 | `db.from('checkins').delete().eq('user_id', manager.id)` | checkins | Simple |
| 118 | `db.from('checkins').delete().eq('user_id', user.id)` | checkins | Simple |
| 125 | `db.from('checkins').insert(rows)` | checkins | Simple |

### 3.5 Simple vs complex, totalled

| Scope | Simple | Complex | Total |
|---|---|---|---|
| Frontend (`src/`) | 20 | 13 | 33 |
| Edge Functions | 3 | 1 | 4 |
| **Runtime subtotal** | **23** | **14** | **37** |
| Dev scripts | 11 | 7 | 18 |
| **All** | **34** | **21** | **55** |

Of the 14 runtime complex call sites, **6 are `.rpc()`**, **5 are auth flow**, **1 is a function invoke**, **1 is an upsert**, and **1 is a count query**. The 6 RPCs are the good news buried in that number: the authorization logic they contain is already server-side Postgres and ports with the schema. What gets rebuilt around them is the transport, not the logic.

---

## 4. Storage

**No Supabase Storage usage exists in this repository.**

Verified by searching all of `src/`, `supabase/`, and `scripts/` for `storage.`, `.upload(`, `.download(`, `getPublicUrl`, and `createSignedUrl`. Zero matches.

- Buckets: **0**
- Objects to migrate: **0**
- Storage RLS policies: **0**
- Access patterns in use: **none**

There is no S3 workstream. Static assets (`public/favicon.svg`, `public/apple-touch-icon.png`, `public/icons.svg`, `src/assets/hero.png`) are bundled by Vite and served by Netlify as part of the static site. They contain no PHI and are not stored in Supabase.

The one generated artifact in the app, the clinic QR code (`Dashboard.jsx:179`), is produced client-side by the `qrcode` npm package into a data URL. It is never uploaded or persisted anywhere.

---

## 5. Realtime

**No Realtime usage exists in this repository. This is a clean zero.**

Verified by searching all of `src/`, `supabase/`, and `scripts/` for `.channel(`, `.subscribe(`, `removeChannel`, `postgres_changes`, `broadcast`, and `presence`. Zero matches.

The single `.unsubscribe()` in the codebase is `auth.jsx:127`, which tears down the `onAuthStateChange` listener on unmount. **That is an in-memory event emitter inside the supabase-js client, not a websocket subscription.** It does not touch Supabase Realtime and has no server component.

Every screen loads its data with a one-shot fetch on mount and refetches manually after a write (`PatientApp.jsx:190` and `:267`; `Dashboard.jsx:158`). Nothing in the product updates live. Nothing depends on a websocket staying open.

**Implication for the plan:** the single biggest unknown named in the brief is removed. There is no Realtime workstream, no AppSync or IoT Core or API Gateway websocket decision to make, and no reason for the AWS design to include a persistent connection tier at all. The app is request/response end to end.

---

## 6. Auth

### 6.1 Flows in use

Exactly **one** user-facing flow: **passwordless 6-digit email OTP.** Send code, type code into the same tab, verified.

| Flow | In use | Where |
|---|---|---|
| OTP code send | **Yes** | `Login.jsx:14`, `Join.jsx:31`, `Onboard.jsx:41` |
| OTP code verify | **Yes** | `CodeVerify.jsx:26` (`verifyOtp({ type: 'email' })`) |
| Session read | **Yes** | `CodeVerify.jsx:31` (`getSession`), `auth.jsx:112` (`onAuthStateChange`) |
| Sign out | **Yes** | `auth.jsx:131` |
| Session refresh | **Yes, implicitly** | supabase-js auto-refreshes. Never called explicitly in app code. Both dev scripts explicitly disable it. |
| Signup | **Implicit, not a separate flow** | `signInWithOtp` defaults to `shouldCreateUser: true`. There is no signup endpoint. Sending a code to an unknown email creates the account. |
| Password login | No | Nothing anywhere. |
| Password reset | No | Nothing anywhere. |
| Magic link (clicked link) | **No, despite appearances** | `emailRedirectTo` is passed at all three call sites, but the product flow is the typed code. `auth.jsx` line 6 and `Join.jsx` line 9 still say "magic link" in comments. Stale wording, not a live flow. |
| Email confirmation | No | Turned off in the Supabase dashboard per CLAUDE.md. `email_confirm: true` is forced in the seed scripts. |
| OAuth / social | No | Nothing anywhere. |
| Invite (Supabase native `inviteUserByEmail`) | **No** | The invite system is a custom table plus RPCs. It does not use Supabase's invite API. |

Admin API, server-side only:

| Call | Where | Purpose |
|---|---|---|
| `auth.admin.listUsers()` | `weekly-summary/index.ts:72`, `seed-demo.mjs:53`, `reset-demo.mjs:51` | Resolve `profile.id` to an email address |
| `auth.admin.createUser()` | `seed-demo.mjs:60`, `reset-demo.mjs:63` | Demo accounts |
| `auth.admin.deleteUser()` | `reset-demo.mjs:99` | Demo teardown |

### 6.2 Where roles live

**In the `profiles` table, in application-owned Postgres. Not in a JWT claim.**

This is the single most consequential fact in this section, and it cuts both ways.

`profiles.role` is a `text` column with `check (role in ('patient','therapist','manager'))` (`0001:25`). Every authorization decision, in policies and in RPC bodies, reads it back out of that table through `auth_role()` or a direct `select ... from profiles where id = auth.uid()`.

- **Nothing reads a role from the JWT.** No `auth.jwt()` anywhere, no custom claims, no `app_metadata` role.
- **Nothing reads a role from `raw_user_meta_data`.** User metadata carries only `full_name`, `clinic_slug`, `consent_version`, `onboard_clinic_name`, `onboard_clinic_slug`. All of it is user-supplied at signup and none of it is trusted for authorization. That is the correct instinct and it should be preserved.
- **The good news for AWS:** roles do not live in Supabase Auth. They live in a table that ports to RDS unchanged. Cognito does not need custom claims, a pre-token-generation Lambda, or group mapping on day one. The token needs to carry a stable subject id and nothing more.
- **The bad news:** the role column is writable by its own owner. See observation 10.2.

`user_metadata` is read in exactly two places: `auth.jsx:32` (profile setup fallbacks) and `Dashboard.jsx:141` (a display-name fallback). Both are cosmetic. Neither grants anything.

### 6.3 How the frontend gets and holds the session

- `createClient` with default options (`supabase.js:6`). No storage override, no PKCE config, no cookie config. **Default behavior: the session, including the refresh token, is persisted in `localStorage`** under a `sb-<project-ref>-auth-token` key, and auto-refreshed by a background timer in the client.
- `AuthProvider` (`auth.jsx:22`) is the single source of truth. It subscribes with `onAuthStateChange` (`:112`), which fires an `INITIAL_SESSION` event on mount and covers both an existing session and later sign-in/sign-out.
- Profile loading is deliberately deferred with `setTimeout(..., 0)` (`:116`) so that queries do not run inside the auth callback's lock. The comment at `:108` says doing so can deadlock and hang the app on "Loading…" forever. **This is a supabase-js client-internals workaround.** It should be deleted, not translated, when the client is replaced. Carrying it forward would preserve a workaround for a lock that no longer exists.
- Session and profile are exposed through React context (`useAuth`, `:144`). Routing reads it (`App.jsx:18`, `:32`). Role checks in `App.jsx` are **UI-level only**; the enforcing checks are the RLS policies. That is the right split and it is worth stating explicitly in the AWS design, because it means an API Gateway authorizer alone is not a substitute for the policies.
- **Cross-tab and cross-device:** `localStorage` is per-origin per-browser. There is no cookie, no server-side session. Anything on AWS that moves to httpOnly cookies is a behavior change to the frontend, not a drop-in.

### 6.4 Anything reading `auth.users` directly

Three places. **Each one is a hard dependency on Supabase's auth schema and none of them survives the move as written.**

1. **`accept_staff_invite()`, `0002_therapists.sql:55`**: `select email from auth.users where id = auth.uid() into v_email`. The staff-invite system is built on matching the signed-in user's email against a pending invite row, and the email is read **from inside Postgres**. On RDS there is no `auth.users` to read. Either the email has to be passed in from the Lambda (having been verified against the Cognito token, never trusted from the client) or an application-owned `users` table has to hold it.
2. **`handle_new_user()` trigger, `0001_multitenant.sql:166` and `:176`**: `after insert on auth.users`, reading `new.raw_user_meta_data->>'full_name'`. This is how every profile row comes into existence. **There is no other code path that creates a bare profile.** With Cognito, no insert into `auth.users` ever happens, so the trigger never fires, so profiles are never created. This has to become an explicit application-side step (a post-confirmation Lambda, or a create-profile call in the sign-in path).
3. **FK constraints**: `profiles.id references auth.users(id) on delete cascade` (`0001:23`), `consents.user_id references auth.users(id)` (`0001:48`), `access_log.actor_id references auth.users(id)` (`0001:62`), `staff_invites.invited_by references auth.users(id)` (`0002:16`). **Four foreign keys point at a table that will not exist on RDS.** The schema does not port cleanly until this is decided. This is the most concrete "schema ports cleanly" caveat in the whole inventory, and it is why the answer to Q1 below determines the shape of the migration.

---

## 7. Edge Functions

Two functions. Both Deno, both deployed to Supabase.

### 7.1 `ai-response`

**File:** `supabase/functions/ai-response/index.ts` (53 lines)

- **What it does:** takes `{ prompt }` from the request body, calls the Anthropic Messages API, returns `{ response: text }`. On any error it returns the fallback string "You showed up today, and that's everything." with a 200.
- **Called from:** `PatientApp.jsx:221`, via `supabase.functions.invoke`.
- **Calls out to:** `https://api.anthropic.com/v1/messages`, model `claude-haiku-4-5-20251001`, `max_tokens: 200`.
- **Touches PHI:** **Yes. This is the PHI-carrying function.** The prompt is assembled at `PatientApp.jsx:211` and contains the patient's first name, their feeling score and word, their movement list, and **their verbatim free-text note**. This is the reroute the brief asks about. Anthropic is a business associate for this call and a BAA is required before real patients.
- **Needs outbound internet:** **Yes.** A Lambda in a VPC needs a NAT gateway or a VPC endpoint to reach `api.anthropic.com`. Worth pricing now: this is the one component that forces egress in an otherwise closed design.
- **Secrets:** `ANTHROPIC_API_KEY`.
- **Auth:** the function body performs **no authentication check of its own.** It does not read the Authorization header, does not verify a JWT, and does not identify the caller. It relies entirely on Supabase's gateway-level `verify_jwt`. CORS is `Access-Control-Allow-Origin: *` (`:11`). See observation 10.8.
- **State:** stateless. No database access at all. It is the easiest function to port and the most sensitive one to get the authorizer right on.

### 7.2 `weekly-summary`

**File:** `supabase/functions/weekly-summary/index.ts` (144 lines)

- **What it does:** reads all clinics, all profiles, all check-ins from the last 7 days, and all auth users. Computes per-patient check-in day counts and per-clinic engagement aggregates. Builds an outbox and sends via Resend. Supports `?dryRun=true` to compute without sending, returning `{ ok, dryRun, queued, sent }`.
- **Called from:** not called from the frontend at all. Invoked by **Supabase Cron (pg_cron plus pg_net)**, job `weekly_summary`, schedule `0 12 * * 1` (Monday 8am ET). Per CLAUDE.md the cron command lives in `cron.job.command` **in the database, not in this repository**, and it contains a service-role key in plaintext. That job definition is migration surface that a code inventory cannot see. See Q3.
- **Calls out to:** `https://api.resend.com/emails`, one POST per recipient in a serial `for` loop (`:133`).
- **Touches PHI:** **Yes, and the distinction matters.** Two email types:
  - **Patient email** (`:118`): recipient's own email address, their first name, and their weekly check-in count. Per the CLAUDE.md analysis this identifies a person and reveals they are a PT patient, so it is individually identifiable health information and the transmitting vendor is a business associate. **This is the reason for the AWS move: Resend has no HIPAA option.** On AWS this becomes SES, which is HIPAA-eligible under the AWS BAA.
  - **Clinic email** (`:128`): clinic name plus aggregate counts only, no names. Genuinely PHI-free.
  - No feelings, notes, or AI reflections appear in any email. The PHI-minimization in the email bodies is careful and deliberate and should be preserved verbatim.
- **Needs outbound internet:** **Yes**, to `api.resend.com` today, to the SES endpoint after. SES has a VPC endpoint available, which `ai-response` does not have an equivalent for.
- **Secrets:** `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (auto-injected by Supabase, not set by hand).
- **Auth:** requires a JWT at the gateway. The caller is not otherwise checked.
- **Runs as service role:** RLS does not apply. Clinic separation is enforced only by the JS filters at `:112` and `:113`.
- **Known open defect, from CLAUDE.md and visible in the code:** `sendEmail` (`:24`) returns a bare `r.ok` and discards the error. The serial loop at `:133` exceeds Resend's rate limit of roughly 2 requests per second and the last message is dropped. The last real run was `{queued: 13, sent: 12}` and still returned a 200. **Reported, not fixed, per the brief.** But it is worth flagging to whoever plans the AWS build: **do not port this function as written.** The batch-send-plus-fail-loudly rewrite that CLAUDE.md already specifies should be done as part of the SES rewrite, not before it and not after. SES has its own rate limits and its own batch semantics, so doing the fix on Resend first would be work thrown away.

### 7.3 Netlify Functions

**None.** `netlify.toml:4` declares `functions = "netlify/functions"`, but `netlify/functions/` is an **empty directory**. Netlify serves only the static bundle. Per CLAUDE.md this is deliberate: PHI goes browser to Supabase directly and never transits Netlify, which is why Netlify is not treated as a business associate. **That property must survive the AWS design.** The moment an AWS-side request carrying PHI is routed through a Netlify function or a Netlify redirect proxy, that reasoning breaks.

---

## 8. Config surface

### 8.1 Environment variables

| Variable | Consumed at | Scope | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `src/supabase.js:3` | **Client bundle** | Vite inlines this at build time. Public by design. |
| `VITE_SUPABASE_ANON_KEY` | `src/supabase.js:4` | **Client bundle** | The publishable key `sb_publishable_...`. Public by design. Verified present in the built bundle at `dist/assets/index-DJEkThsK.js`. |
| `ANTHROPIC_API_KEY` | `ai-response/index.ts:32` | Edge Function secret | Server-side only. Correct. |
| `RESEND_API_KEY` | `weekly-summary/index.ts:13` | Edge Function secret | Server-side only. Correct. Goes away with Resend. |
| `FROM_EMAIL` | `weekly-summary/index.ts:14` | Edge Function secret | Defaults to `GlowPT <onboarding@resend.dev>`. |
| `APP_URL` | `weekly-summary/index.ts:15` | Edge Function secret | Defaults to the old `https://glowpt-app.netlify.app`. Stale default, live value is correct per CLAUDE.md. |
| `SUPABASE_URL` | `weekly-summary/index.ts:18`, `seed-demo.mjs:14`, `reset-demo.mjs:11` | Auto-injected / local shell | |
| `SUPABASE_SERVICE_ROLE_KEY` | `weekly-summary/index.ts:19`, `seed-demo.mjs:15`, `reset-demo.mjs:12` | Auto-injected / local shell | **See below.** |

Netlify build-time env (from CLAUDE.md, not visible in the repo): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

### 8.2 Anon key vs service role key

**Anon (publishable) key** is used in exactly one place: `src/supabase.js:6`, the browser client. It is compiled into the public JS bundle, which is correct and expected. Its power is bounded entirely by RLS. Per CLAUDE.md it is trivially liftable from the bundle, which is true of every Supabase app and is not itself a finding.

**Service role key** is used in exactly three places, **all server-side or local, none reachable from the browser**:

1. `supabase/functions/weekly-summary/index.ts:19` (auto-injected by the Supabase Edge runtime, never handled by a person)
2. `scripts/seed-demo.mjs:15` (read from `process.env`, run locally by David)
3. `scripts/reset-demo.mjs:12` (same)

**No service role key is reachable from client-side code.** Verified: no `VITE_`-prefixed key contains a service or secret credential in `.env`; `src/` contains no reference to `SERVICE_ROLE`, `sb_secret`, or `service_role`; the built bundle contains no `sk-ant` string. Both scripts fail closed if the key is absent (`seed-demo.mjs:16`, `reset-demo.mjs:13`), and both carry an explicit warning comment that the key bypasses security rules and must never go in the app (`seed-demo.mjs:11`).

**This is a clean result and worth saying plainly: the key hygiene in the shipped code is correct.** The findings in section 10 are about policy design and local leftovers, not about a leaked service key.

One key does live outside the code, in `cron.job.command` in the database, in plaintext. CLAUDE.md documents this and documents that it must never be screenshotted. It is not in this repository, but it is migration surface.

### 8.3 Local env files

| File | Tracked in git | Contents |
|---|---|---|
| `.env` | No | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Both public-by-design. |
| `.env.backup` | No | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, **`VITE_ANTHROPIC_API_KEY`** |
| `.env.save` | No | Same three, plus shell noise. Mode 600. |

`.gitignore` ends with `.env` and `.env.*`, and `git ls-files` confirms **no env file has ever been tracked**. The 41 tracked files contain no secret. See observation 10.9 for the `VITE_ANTHROPIC_API_KEY` leftover.

---

## 9. Frontend third-party scripts

**Zero.** No vendor script runs on any page that handles PHI.

- `index.html` contains exactly one `<script>`: `<script type="module" src="/src/main.jsx">`, the app's own entry point (`index.html:15`).
- The built `dist/index.html` contains exactly one: the hashed bundle `/assets/index-DJEkThsK.js` (`dist/index.html:12`).
- No analytics, tag manager, error tracker, session recorder, heatmap, chat widget, or A/B tool. Searched `package.json`, `index.html`, and all of `src/` for Sentry, PostHog, Google Analytics / gtag, Segment, Mixpanel, Hotjar, FullStory, Datadog, LogRocket, and Microsoft Clarity. Zero matches.
- No `<link>` to an external font or CDN. The fonts referenced in inline styles (`DM Sans`, `Fraunces`) are named in CSS but not loaded from a remote host by any tag in `index.html`.

Full runtime dependency list (`package.json:12`), all bundled, none phoning home:

| Package | Purpose | Sends data anywhere |
|---|---|---|
| `@supabase/supabase-js` ^2.105.4 | The backend client | Yes, to Supabase. The thing being migrated. |
| `react` ^19.2.6, `react-dom` ^19.2.6 | UI | No |
| `react-router-dom` ^7.18.1 | Routing | No |
| `qrcode` ^1.5.4 | Clinic QR code, generated client-side | No |

**Business associate implication:** on the frontend, the list of vendors that would need a BAA is **empty**. Today the full BA list for the product is Supabase, Anthropic, and Resend. Netlify is excluded by the no-PHI-transits-Netlify property described in 7.3. After the move it becomes AWS (one BAA covering RDS, Cognito, Lambda, SES) and Anthropic. **That is a reduction from three vendors to two, and it is a real and underrated benefit of this migration.** Listing, not judging.

---

## 10. Observations

Ordered by how much they could cost. Reported only, nothing fixed, nothing touched.

### 10.1 The `checkins` table is not defined in this repository

`0001_multitenant.sql:37` runs `alter table public.checkins add column if not exists ...` against a table that predates the migrations. **No `create table` for `checkins` exists anywhere in the repo.** Confirmed by search.

The repo therefore knows about only three of its columns: `clinic_id`, `other_movement`, `created_at`. The columns the app reads and writes every day, inferred from usage rather than from DDL:

| Column | Evidence | Type, inferred |
|---|---|---|
| `id` | `PatientApp.jsx:247`, `:257` | uuid presumably, not confirmed |
| `user_id` | every policy, `clinicData.js:11` | uuid, FK target unknown |
| `feeling` | `PatientApp.jsx:175`, `clinicData.js:78` | int, 1 to 5 |
| `feeling_word` | `PatientApp.jsx:175` | text |
| `movements` | `PatientApp.jsx:175`, written as a JS array at `:234` | text[] or jsonb, **unknown which** |
| `note` | `PatientApp.jsx:175` | text, **free-text PHI** |
| `ai_response` | `PatientApp.jsx:175` | text |

**Why this matters more than it looks:** the brief's premise is "the database schema ports cleanly." That is true only for the 5 tables the repo defines. For the single most important table, **the source of truth is the live Supabase database and nowhere else.** Nobody can write the RDS DDL for `checkins` from this repository. It has to be dumped (`pg_dump --schema-only`) before anyone can size or sequence the database work. Two specific unknowns that a dump resolves and guessing does not: whether `movements` is `text[]` or `jsonb` (they behave differently and the client passes a raw JS array either way), and whether `user_id` has an FK to `auth.users` like the other three tables do, which would add a fifth broken constraint to the list in 6.4.

Also worth noting: there is **no `0000` baseline migration**, so the repo's migration history cannot rebuild the database from empty. A fresh environment cannot be stood up from this repo today. That is a pre-existing condition, not something the AWS move creates, but the AWS move is exactly when it stops being survivable.

### 10.2 `profiles_update_self` appears to allow self-promotion to manager of any clinic

**This is the most serious thing in this document.** Flagging per the brief; not fixing, not touching.

`profiles_update_self` (`0001_multitenant.sql:127`) is:

```sql
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
```

It restricts **which row** you may update. It does not restrict **which columns**. No migration issues a `revoke`, no column-level grant narrows `authenticated`, and there is no `BEFORE UPDATE` trigger on `profiles`. All confirmed by search. So an authenticated user appears able to update any column of their own profile row, including `role` and `clinic_id`.

The chain, as I read it:

1. `clinics_select` is `USING (true)` for `anon`, so **every clinic uuid in the system is readable by anyone**, with no account at all.
2. Any authenticated user (a patient, or anyone at all, since `/login` creates an account for any email per V2.4) sets their own `profiles.role = 'manager'` and `profiles.clinic_id = <any clinic uuid from step 1>`. Both writes satisfy `id = auth.uid()`.
3. `auth_role()` now returns `'manager'` and `auth_clinic_id()` now returns the target clinic, because both helpers read the row the user just rewrote.
4. `profiles_select_clinic` and `checkins_select_clinic` now pass. The user reads **every patient name and every check-in, including free-text notes, for a clinic they have no relationship with.**

That is a cross-tenant PHI read, reachable by anyone with an email address, and RLS is the only control in front of it.

**Important caveats, stated honestly:**

- **This is reasoned from the policy text and the absence of counter-measures. I did not execute it against the live database.** The brief says to read, not to write, and testing this would mean writing. It should be confirmed empirically before anyone acts on it, and confirming it takes about two minutes in the SQL Editor as a non-manager user.
- The exposure today is **demo data only**. There is no real PHI in the system. This is a design defect, not an incident.
- **It cannot simply be dropped.** `auth.jsx:72` (`update({ full_name })`) and `auth.jsx:84` (the profile `upsert`) both depend on a patient being able to write their own profile row. Removing the policy breaks patient join. The fix is a real design decision (column-level grants, a trigger that pins `role` and `clinic_id`, or routing name changes through a SECURITY DEFINER RPC like every other privileged write already is), which is a conversation with David, not a line edit.
- **It is worth resolving as part of the AWS port rather than before it.** The policy is being rewritten anyway, the same hole would be transcribed straight into RDS if it is ported verbatim, and the codebase already has the right pattern for it: every other privileged write in this app goes through a SECURITY DEFINER function that sets role server-side. `accept_staff_invite` even carries a comment at `0002:49` saying "the client never chooses its own role." That intent is correct and `profiles_update_self` quietly undoes it.

### 10.3 Four foreign keys and one trigger point at `auth.users`, which will not exist

Covered in detail in 6.4. Restated here because it is the concrete answer to "does the schema port cleanly": **not until this is decided.**

- `profiles.id references auth.users(id) on delete cascade`
- `consents.user_id references auth.users(id) on delete cascade`
- `access_log.actor_id references auth.users(id) on delete cascade`
- `staff_invites.invited_by references auth.users(id) on delete set null`
- `on_auth_user_created after insert on auth.users` is **the only thing that ever creates a profile row**
- `accept_staff_invite()` does `select email from auth.users` from inside Postgres

The decision (an application-owned `users` table mirroring Cognito, versus dropping the FKs and holding the sub as a bare uuid) shapes the schema, the sign-in Lambda, and the entire staff-invite flow. It is question Q1 and it is the first one to answer.

### 10.4 `clinics` is readable by `anon` with `USING (true)`

Deliberate and documented (`0001:108`): a logged-out patient opening `/join/<slug>` must resolve the clinic. The comment correctly notes there is no PHI in the table.

Two things worth naming anyway:

- It makes **the full customer list enumerable by anyone**: `select id, name, slug from clinics` with the publishable key returns every clinic. Commercially that is your customer roster. Not a HIPAA issue.
- It is **step 1 of the chain in 10.2**, supplying the clinic uuid. On its own it is benign. Combined with `profiles_update_self` it is not. Neither policy is wrong in isolation, which is exactly why this is worth writing down.

A narrower policy (`USING (true)` restricted to the `slug` lookup, or a SECURITY DEFINER resolver function) would serve `/join` equally well. Design decision, not a fix to make here.

### 10.5 Authorization enforced in JavaScript rather than in a policy: two places

The brief asks specifically about this.

1. **`weekly-summary` (`:112` and `:113`)** runs as service role, so RLS is off. It reads **every profile and every check-in across every clinic** (`:70`, `:71`) and separates clinics with `profiles.filter(p => p.clinic_id === clinic.id)`. A bug in that filter sends one clinic's data to another clinic's staff. It is correct as written today. It is correct because of a JS array filter, with no database backstop. On Lambda plus RDS this is the same risk with the same shape, and it is the one place where "port it as-is" carries real consequence. **Scoping the queries per clinic rather than reading globally and filtering in memory would remove the class**, and the rewrite is already happening for SES.

2. **`App.jsx:25`, `:28`, `:37`** gate routing by role. These are UI only and correctly so: the real enforcement is RLS, and CLAUDE.md is explicit that therapist caseload scoping is "enforced by RLS, not just UI." **Called out only so the AWS design does not mistake an API Gateway authorizer for sufficient authorization.** It is not. The policies are.

Everything else, including all six RPCs, enforces authorization in the database. Every RPC re-derives the caller's clinic and role with `select clinic_id from profiles where id = auth.uid() and role = 'manager'` and raises if null, rather than trusting a parameter. That pattern is used consistently in all four manager RPCs (`0002:35`, `0002:79`, `0003:24`, `0003:40`). **It is genuinely well built and it ports as-is.**

### 10.6 Things that would behave differently under Lambda's connection model

The brief asks. Honest answer: **less than you would expect, and the reason is worth understanding.**

Nothing in this app holds a Postgres connection. Every call goes over HTTPS to PostgREST, which does the pooling. There is no `pg` client, no connection string, no pool config, and no long-lived transaction anywhere in the repo. So there is no code that breaks on a cold start today. But that is a property of PostgREST, and **PostgREST is the thing AWS does not have.** The moment Lambdas talk to RDS directly, connection management becomes yours:

- **Connection exhaustion is a new class of problem, not a ported one.** Each concurrent Lambda opens its own connection. **RDS Proxy is effectively required**, not an optimization.
- **`auth.uid()` becomes a per-request setup step.** Whatever replaces it (typically `current_setting('request.jwt.claim.sub', true)::uuid`) has to be set on **every** connection, on **every** invocation, **inside the transaction**, from the verified token. With RDS Proxy multiplexing connections across invocations, a session-level `set` that leaks across requests is a cross-tenant data leak. This is the single highest-risk mechanical detail in the migration: **use `set_config(..., true)` (transaction-scoped), never `set` (session-scoped).** Every one of the 17 policies depends on getting this exactly right.
- **`PatientApp.jsx:246` to `:262` is a read-then-update-else-insert with no transaction.** Today two rapid submits can both read "no row exists" and both insert, which is the duplicate-check-in bug V2.3 addressed from the other side. Under Lambda this is unchanged in kind but the window is not smaller. A unique index on `(user_id, date(created_at))` would make it impossible at the database level rather than probable-not-to-happen at the app level. Noting, not fixing.
- **`weekly-summary` reads every profile and every check-in into memory.** Fine at 13 recipients. At 40 clinics it is a Lambda memory and timeout question, and the serial send loop is already the source of the known drop. Both argue for the same rewrite.
- **`ai-response` needs egress to `api.anthropic.com`.** In a VPC that means a NAT gateway, which is a real recurring cost line that should be in the plan now rather than discovered later.

### 10.7 The HIPAA audit log write is fire-and-forget

`Dashboard.jsx:169`:

```js
supabase.from('access_log').insert({ actor_id: user.id, action: 'view_roster', clinic_id: profile.clinic_id })
```

Not awaited. No error handling. No return value inspected. If it fails, the staff member sees the roster anyway and nothing anywhere records that the view happened.

This is the **audit trail for staff access to patient data**, described in `0001:57` as the thing infrastructure logs do not cover. It is a HIPAA control. It is also, structurally, exactly the silent-failure shape CLAUDE.md names as the recurring bug in this codebase: something fails and the system reports success. This looks like a fifth instance of it, in the one place where the consequence is regulatory rather than cosmetic.

Also worth noting: it is guarded by `logged.current` (`:167`) so it fires once per dashboard mount, and there is **no `view_patient` log anywhere** despite `0001:63` naming that action and `access_log.target_user_id` existing for it. Opening an individual patient's detail appears to log nothing. Whether that is a gap depends on what the compliance posture needs to be, which is David's call, not mine.

### 10.8 `ai-response` has no authorization of its own, and CORS is `*`

The function body (`ai-response/index.ts:17` to `:53`) never reads the Authorization header. It accepts any `{ prompt }` and bills David's Anthropic account. Its only gate is Supabase's gateway `verify_jwt`, and per CLAUDE.md the publishable key lifted from the public bundle returns 200. CORS is `Access-Control-Allow-Origin: *` (`:11`).

CLAUDE.md already has this as a known item ("close before real clinics"). Restating for the migration, because the design decision is different on AWS: the Supabase gateway does this for free today, so the function got away with having no opinion. **An API Gateway route has no equivalent default.** Whatever replaces it needs an explicit authorizer, and the function should probably identify its caller regardless. Do not carry "the gateway handles it" across, because the gateway that handled it does not come along.

### 10.9 A `VITE_`-prefixed Anthropic key is in local env backups

`.env.backup` and `.env.save` both contain `VITE_ANTHROPIC_API_KEY`.

Facts, stated carefully:

- **Not in git.** `git ls-files` shows no env file has ever been tracked. `.gitignore` covers `.env` and `.env.*`. Confirmed.
- **Not in the current bundle.** `dist/assets/index-DJEkThsK.js` contains no `sk-ant` string. Confirmed.
- **Not referenced by any current source file.** No `src/` file mentions Anthropic. Confirmed. This matches CLAUDE.md: the AI moved to the Edge Function and the Netlify Anthropic keys were removed.
- **But the `VITE_` prefix means Vite inlined it into the client bundle at build time, back when `src/` still read it.** Any build from that era shipped a live Anthropic key to every visitor in plain text. That bundle was served publicly from Netlify.

So: the current state is clean, and the cleanup was done correctly. The open question is whether **that specific key was ever rotated after it stopped being public**, or whether it is still live and is the same key now sitting in `ANTHROPIC_API_KEY` as an Edge secret. This repository cannot answer that. If it was never rotated, it should be, and the two backup files should go. Given the secret-key hygiene episode already recorded in CLAUDE.md for 2026-07-16, this is worth ten minutes.

### 10.10 Identifiers in URLs: clean, with one caveat to preserve

The brief asks specifically, because Netlify's CDN logs request paths and query strings.

**Checked every route (`App.jsx:44` to `:49`). No patient identifier appears in any URL.**

| Route | Contains | PHI |
|---|---|---|
| `/join/:slug` | Clinic slug only, e.g. `riverside-pt` | No. Public by design, printed on QR codes. |
| `/onboard`, `/login`, `/dashboard`, `/` | Static | No |

- **No user uuid, email, or check-in id is ever in a path or a query string.** Patient data is selected by `auth.uid()` server-side, never by a URL parameter. That is the right design and it is doing real work for you: it is a large part of why Netlify can be excluded as a business associate.
- The only query string in the system is `?dryRun=true` on `weekly-summary` (`:64`), which is not a browser URL and carries nothing.
- **The caveat:** this property is currently a happy accident of there being no patient-detail route. The moment someone builds "click a patient to see their check-ins", the obvious implementation is `/patient/:id`, and **that uuid lands in Netlify's CDN logs and in API Gateway access logs**, which puts an identifier somewhere it must not be. The owner/super-admin dashboard in the CLAUDE.md backlog is exactly the feature that would do this. Worth writing into the AWS design as a rule now, while it costs nothing, rather than discovering it in an audit later.
- Related: `emailRedirectTo` is passed at all three OTP call sites, and `window.location.origin` is what gets sent. No PHI. Fine.

### 10.11 Smaller notes

- **`consents_select_clinic` still grants therapists clinic-wide read** (`0001:150`), while `0002` narrowed `profiles` and `checkins` to the therapist's own caseload. A therapist can see consent rows for patients not assigned to them. Low impact (a consent row is name plus timestamp plus version), but it is an inconsistency in the caseload model rather than an obvious intent. See Q4.
- **No DELETE policy on any table.** Nothing can be deleted through the API by any user. Deletion happens only via the service role in `reset-demo.mjs`. This is probably correct for a HIPAA product with a soft-delete discharge model, and it is worth stating as an intentional property so it is not accidentally dropped in the port.
- **`PatientApp.jsx:231`** still sends `clinic_id: profile?.clinic_id ?? null`. Since `0004`, a null clinic is rejected by RLS, so this fails closed correctly. The `?? null` is now dead defensiveness rather than a hole. Noting only because it reads like a bug and is not one.
- **Two stale defaults in `weekly-summary`:** `FROM_EMAIL` defaults to `onboarding@resend.dev` (`:14`) and `APP_URL` defaults to `https://glowpt-app.netlify.app` (`:15`). Live secrets override both per CLAUDE.md. They would only bite if a secret went missing, at which point the function silently sends from the wrong address rather than failing. Same silent-failure family.
- **Stale comments say "magic link"** in `auth.jsx:6`, `auth.jsx:7`, and `Join.jsx:9`. The product uses typed OTP codes. The comments are wrong, not the code. Worth correcting whenever those files are touched, because "magic link" in a comment is exactly the sort of thing that misleads someone planning an auth port.
- **`netlify.toml:4` declares an empty functions directory.** Harmless. Possibly worth deleting so nobody infers a Netlify function tier exists.
- **`vite.config.js`, `eslint.config.js`, `README.md`** contain nothing migration-relevant. Checked.

---

## 11. Questions for claude.ai

David asked me to flag open questions here. These are the ones where a wrong assumption changes the plan rather than just the wording, roughly in the order they need answering.

**Q1. What replaces `auth.users`, and does an application-owned `users` table come along?** This is the first decision and it blocks the schema. Four FKs, one trigger, and `accept_staff_invite`'s `select email from auth.users` all depend on it (6.4, 10.3). Two shapes: (a) an app-owned `users(id uuid pk, email citext unique)` table that a Cognito post-confirmation Lambda writes, keeping all four FKs intact and letting `accept_staff_invite` port almost unchanged; or (b) drop the FKs, treat the Cognito sub as a bare uuid, and pass the verified email into the invite RPC as a parameter. (a) preserves more of the existing SQL and keeps referential integrity. (b) is less to build. My read is that (a) is worth it precisely because `accept_staff_invite` is the flow most likely to break subtly, but this is a design call, not a fact I can extract from the repo.

**Q2. How is `auth.uid()` reimplemented, and is the transaction-scoping rule written into the plan explicitly?** All 17 policies and 9 functions funnel through it (2.8). The standard answer is `current_setting('request.jwt.claim.sub', true)::uuid` set per request. The part that needs to be a stated rule and not an implementation detail: **with RDS Proxy multiplexing connections, this must be `set_config(..., true)` inside the transaction, never a session-level `set`.** A leaked session variable across pooled invocations is a cross-tenant PHI read. If the plan names one non-negotiable mechanical rule, this is my nomination for it.

**Q3. Is the pg_cron job definition captured anywhere outside the database?** `weekly-summary` is triggered by `cron.job.command` in Postgres, which is not in this repository and which CLAUDE.md documents as containing a service-role key in plaintext. It is migration surface that a code inventory structurally cannot see. It becomes EventBridge plus Lambda, which is simpler and removes the plaintext key. Flagging so it does not fall between "not in the repo" and "not in the plan". Related: CLAUDE.md item 4 records an unexplained `queued: 14 / 0 / 13` sequence that was never root-caused. If that was a stale-instance or env issue, it dies with the platform. If it was a data issue, it follows you to AWS. Worth deciding whether to chase it before the move or accept it as retired.

**Q4. Is `consents_select_clinic` granting therapists clinic-wide read intentional?** `0002` narrowed `profiles` and `checkins` to caseload but left `consents` at `therapist` or `manager` clinic-wide (10.11). Either it is an intentional exception or it is an oversight from the caseload work. If the policies are being ported anyway, this is the cheap moment to make the caseload model consistent, but only David knows which was meant.

**Q5. Does the two-week target include closing 10.2, and does it include the `weekly-summary` rewrite?** Both are already-known work colliding with the migration. 10.2 is a design decision on a security policy that would otherwise be transcribed into RDS verbatim. The `weekly-summary` fix that CLAUDE.md specifies (batch endpoint, fail loudly, `sent === queued`) should be folded into the SES rewrite rather than done twice on two different email providers. I would sequence both inside the migration rather than around it, but they are days, and the brief says this document is the input to whether two weeks is real.

**Q6. Has the pre-Edge-Function Anthropic key been rotated?** (10.9). The repo cannot tell. If not, it was public in a shipped bundle and should be rotated regardless of the migration.

**Q7. What is `movements`, `text[]` or `jsonb`?** Not answerable from the repo, because the `checkins` DDL is not in the repo (10.1). It is one line of a `pg_dump --schema-only`, and it is a real fork in the client rewrite. Same dump answers whether `checkins.user_id` carries a fifth FK to `auth.users`, which would feed straight back into Q1.

---

## Appendix: what was read

Every file below was read in full or, where noted, in the regions relevant to backend surface. Nothing was inferred from a filename.

**Source (11):** `src/App.jsx`, `src/main.jsx`, `src/auth.jsx`, `src/supabase.js`, `src/lib/clinicData.js`, `src/lib/feelings.js`, `src/screens/PatientApp.jsx` (backend regions), `src/screens/Dashboard.jsx` (backend regions), `src/screens/Join.jsx`, `src/screens/Login.jsx`, `src/screens/Onboard.jsx`, `src/screens/CodeVerify.jsx`. Also confirmed clean of backend calls: `src/screens/AuthShell.jsx`, `src/screens/Landing.jsx`, `src/screens/NoClinic.jsx`.

**Migrations (4):** `0001_multitenant.sql`, `0002_therapists.sql`, `0003_discharge.sql`, `0004_require_clinic.sql`. All read in full.

**Edge Functions (2):** `ai-response/index.ts`, `weekly-summary/index.ts`. Both read in full.

**Scripts (2):** `seed-demo.mjs`, `reset-demo.mjs`.

**Config:** `package.json`, `netlify.toml`, `public/_redirects`, `index.html`, `dist/index.html`, `.gitignore`, `.env` / `.env.backup` / `.env.save` (key names only, values never read or printed), `vite.config.js`, `eslint.config.js`.

**Not available to this inventory, and needed:** the live `checkins` table DDL, the `cron.job` row, the Supabase dashboard auth settings, and the Edge Function secret values. All four are database or console state, not code.
