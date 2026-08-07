-- ============================================================================
-- GlowPT: db/schema.sql  ---  SINGLE SCHEMA-OF-RECORD FOR AWS (RDS Postgres)
-- ============================================================================
-- DRAFT for David's review (2026-08-07). Applies to nothing yet: no RDS exists.
--
-- Written fresh against the AWS identity model, NOT transcribed from Supabase.
-- Source of truth for the port: supabase/migrations/0000_baseline.sql (the live
-- dump), which is FROZEN history and is never edited or replayed. The old
-- 0001-0004 migrations are archived history too.
--
-- What is DELIBERATELY different from the live Supabase database, and why:
--   1. public.users replaces Supabase's auth.users (Decision Q1). All 5 FKs
--      that pointed at auth.users now point here. ON DELETE rules unchanged.
--   2. current_user_id() replaces auth.uid() (Decision Q2). It reads a
--      per-transaction setting the Lambda sets from the VERIFIED Cognito token.
--   3. The 3 orphan "V1-era" checkins policies from the live DB are GONE. One of
--      them ("Allow anonymous inserts for testing" = with check (true)) is the
--      unauthenticated-insert hole. It simply never appears here. (Hole 2 fix.)
--   4. profiles_update_self is REDESIGNED, not ported: a patient can edit only
--      their own full_name; role/clinic_id are refused by the database itself.
--      (Hole 1 fix; full design in glowpt-profiles-update-fix-design.md.)
--   5. FORCE ROW LEVEL SECURITY on every table (Rule 3). Grants are explicit and
--      minimal (Rule 2), so we get grants AND policies, not just policies.
--   6. consents therapist read narrowed to caseload (Decision Q4).
--
-- Roles (see the ROLES section for the full rationale):
--   glowpt_owner : owns the tables. NOLOGIN, no bypass. FORCE applies to it too.
--   glowpt_auth  : owns the SECURITY DEFINER functions. NOLOGIN, BYPASSRLS.
--                  This is the trusted internal role (Supabase's "postgres").
--   glowpt_app   : the ONLY login role; the Lambda connects as this. Non-owner,
--                  minimal grants, fully subject to RLS.
--
-- NOTE (migration standing rule): no em dashes anywhere in this file.
-- ============================================================================


-- ============================ EXTENSIONS ============================
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email


-- ============================ ROLES ============================
-- Created idempotently. The Lambda's password for glowpt_app is set OUT OF BAND
-- (aws secrets / provisioning), never in this file. No secret ever lives here.
--
-- Why three roles instead of one:
--   * The helper functions (auth_role, auth_clinic_id, is_my_patient) read
--     public.profiles, and profiles' OWN policies call those helpers. Under
--     FORCE RLS that is an infinite recursion UNLESS the function runs as a role
--     that bypasses RLS. That role is glowpt_auth (BYPASSRLS).
--   * But Rule 3 wants FORCE to bite even the TABLE owner as a backstop. So the
--     table owner (glowpt_owner) must NOT have BYPASSRLS.
--   * Therefore table-owner and function-owner are split. Only glowpt_app logs
--     in, and RLS fully governs it.
--
-- RDS caveat to confirm at provisioning: creating a BYPASSRLS role may require
-- privileges rds_superuser does or does not have depending on engine version.
-- If BYPASSRLS is restricted, that is a provisioning-time decision to resolve;
-- the Phase 1.3 tests will prove whether recursion is actually avoided.
do $$
begin
  if not exists (select from pg_roles where rolname = 'glowpt_owner') then
    create role glowpt_owner nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'glowpt_auth') then
    create role glowpt_auth nologin bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'glowpt_app') then
    create role glowpt_app login;   -- password set out of band
  end if;
end $$;

-- The role running this script must be a member of these roles to reassign
-- ownership to them below.
grant glowpt_owner, glowpt_auth, glowpt_app to current_user;

-- Leave Supabase's wide-open default posture behind (Rule 2 spirit).
revoke all on schema public from public;
grant usage on schema public to glowpt_app, glowpt_auth, glowpt_owner;


-- ============================ TABLES ============================
-- Column shapes are preserved EXACTLY as the live database actually is (per
-- glowpt-task-1-findings.md), not as the migration files wrongly claimed.

-- ---- public.users (replaces auth.users) ----
create table public.users (
  id         uuid primary key,                    -- the Cognito "sub"
  email      citext unique not null,
  created_at timestamptz not null default now()
);

-- ---- public.clinics (no PHI) ----
create table public.clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  baa_signed_at timestamptz,
  baa_version   text,
  created_at    timestamptz not null default now()
);

-- ---- public.profiles (PHI: names a person as a patient of a clinic) ----
create table public.profiles (
  id           uuid primary key references public.users(id) on delete cascade,
  clinic_id    uuid references public.clinics(id) on delete set null,
  role         text not null default 'patient'
                 check (role in ('patient','therapist','manager')),
  full_name    text,
  therapist_id uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  discharged_at timestamptz
);
create index profiles_clinic_idx    on public.profiles (clinic_id);
create index profiles_therapist_idx on public.profiles (therapist_id);

-- ---- public.checkins (CORE PHI: free-text note is patient-authored) ----
-- Preserved AS-IS from the live DB: user_id nullable, created_at nullable with a
-- UTC default, id from pgcrypto. Do NOT inherit 0001's false NOT NULL claims.
-- (Two optional tightenings are PROPOSED, commented, at the end of this file.)
create table public.checkins (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete cascade,
  feeling        integer not null,
  feeling_word   text,
  movements      text[],
  note           text,
  ai_response    text,
  created_at     timestamptz default timezone('utc', now()),
  other_movement text,
  clinic_id      uuid references public.clinics(id) on delete cascade
);
create index checkins_clinic_idx on public.checkins (clinic_id, created_at desc);
create index checkins_user_idx   on public.checkins (user_id, created_at desc);

-- ---- public.consents (PHI) ----
create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  clinic_id    uuid references public.clinics(id) on delete set null,
  type         text not null default 'hipaa_patient_ack',
  version      text not null default 'v1',
  consented_at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id);

-- ---- public.access_log (HIPAA audit trail; append-only) ----
create table public.access_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid not null references public.users(id) on delete cascade,
  action         text not null,
  target_user_id uuid,
  clinic_id      uuid references public.clinics(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index access_log_clinic_idx on public.access_log (clinic_id, created_at desc);

-- ---- public.staff_invites (staff, not PHI) ----
create table public.staff_invites (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'therapist' check (role in ('therapist','manager')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (clinic_id, email)
);
create index staff_invites_email_idx on public.staff_invites (email) where (consumed_at is null);


-- ============================ IDENTITY: current_user_id() ============================
-- Reads the transaction-scoped setting the Lambda MUST set with
-- set_config('app.user_id', <sub from verified JWT>, true). Never session-level
-- (RDS Proxy multiplexes connections; a leaked session value is a cross-tenant
-- PHI read). SECURITY INVOKER: it touches no table, so no RLS concern.
create or replace function public.current_user_id() returns uuid
  language sql stable
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;


-- ============================ HELPER FUNCTIONS ============================
-- SECURITY DEFINER + owned by glowpt_auth (BYPASSRLS) so reading profiles from
-- inside a profiles policy does not recurse under FORCE. set row_security = off
-- is belt-and-suspenders: with BYPASSRLS it is a no-op, but if BYPASSRLS were
-- ever removed it fails loudly instead of recursing forever.
create or replace function public.auth_role() returns text
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$ select role from public.profiles where id = public.current_user_id() $$;

create or replace function public.auth_clinic_id() returns uuid
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$ select clinic_id from public.profiles where id = public.current_user_id() $$;

create or replace function public.is_my_patient(p_user uuid) returns boolean
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$ select exists (
  select 1 from public.profiles
  where id = p_user and therapist_id = public.current_user_id()
) $$;


-- ============================ PRIVILEGED RPCs ============================
-- Ported from the baseline with two mechanical swaps: auth.uid() ->
-- current_user_id(), auth.users -> public.users. All keep their server-side
-- authorization (each re-derives the caller's clinic and role; nothing is
-- trusted from a parameter). All owned by glowpt_auth, all set row_security off.

-- register_user: the AWS replacement for the handle_new_user trigger, which
-- cannot port (there is no auth.users to fire on). The Cognito post-confirmation
-- Lambda (Phase 2) calls this to create the identity row + a bare profile.
create or replace function public.register_user(
    p_id uuid, p_email citext, p_full_name text default null)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
begin
  insert into public.users (id, email) values (p_id, lower(p_email))
    on conflict (id) do nothing;
  insert into public.profiles (id, full_name)
    values (p_id, nullif(trim(p_full_name), ''))
    on conflict (id) do nothing;
end $$;

-- get_clinic_by_slug: the ONLY unauthenticated data read in the app (a new
-- patient with no account resolving their clinic from /join/<slug>). Replaces
-- the old clinics "USING (true)" blanket, which exposed the entire customer
-- list. This returns exactly one clinic's public fields for one slug.
create or replace function public.get_clinic_by_slug(p_slug text)
  returns table (id uuid, name text, slug text)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.id, c.name, c.slug
  from public.clinics c
  where c.slug = lower(trim(p_slug))
$$;

create or replace function public.provision_clinic(p_name text, p_slug text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic_id uuid;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  insert into public.clinics (name, slug) values (p_name, p_slug) returning id into v_clinic_id;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_clinic_id, 'manager', null)
    on conflict (id) do update set clinic_id = v_clinic_id, role = 'manager';
  return v_clinic_id;
end $$;

-- join_clinic: replaces the client-side profile upsert in the patient join flow.
-- Role is pinned to 'patient' server-side; clinic resolved from the slug; a
-- staff member is refused, not downgraded; consent written in the same txn.
create or replace function public.join_clinic(
    p_slug text, p_full_name text, p_consent_version text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;

  select id from public.clinics where slug = lower(trim(p_slug)) into v_clinic;
  if v_clinic is null then raise exception 'Clinic not found'; end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot self-join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_clinic, 'patient', nullif(trim(p_full_name), ''))
    on conflict (id) do update
      set clinic_id = v_clinic,
          role      = 'patient',
          full_name = coalesce(public.profiles.full_name, excluded.full_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_clinic, 'hipaa_patient_ack', p_consent_version);
  end if;

  return v_clinic;
end $$;

create or replace function public.accept_staff_invite()
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email text; v_inv record;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  select email from public.users where id = public.current_user_id() into v_email;
  select * from public.staff_invites
    where email = lower(v_email) and consumed_at is null
    order by created_at desc limit 1 into v_inv;
  if v_inv.id is null then return null; end if;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_inv.clinic_id, v_inv.role, v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = v_inv.role,
          full_name = coalesce(public.profiles.full_name, v_inv.full_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

create or replace function public.invite_staff(
    p_email text, p_full_name text, p_role text default 'therapist')
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, public.current_user_id())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null;
end $$;

create or replace function public.assign_therapist(p_patient uuid, p_therapist uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can assign therapists'; end if;
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic';
  end if;
  if p_therapist is not null and not exists (
      select 1 from public.profiles
      where id = p_therapist and clinic_id = v_clinic and role = 'therapist') then
    raise exception 'Therapist not in your clinic';
  end if;
  update public.profiles set therapist_id = p_therapist where id = p_patient;
end $$;

create or replace function public.discharge_patient(p_patient uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can discharge patients'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic'; end if;
  update public.profiles set discharged_at = now() where id = p_patient;
end $$;

create or replace function public.restore_patient(p_patient uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can restore patients'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic'; end if;
  update public.profiles set discharged_at = null where id = p_patient;
end $$;


-- ============================ ROW LEVEL SECURITY ============================
-- Rule 3: enable AND force on every table. FORCE makes even the table owner
-- (glowpt_owner) subject to policies, so an accidental owner connection is still
-- fenced in. glowpt_auth bypasses via BYPASSRLS (that is deliberate and scoped
-- to the SECURITY DEFINER functions, since glowpt_auth cannot log in).
alter table public.users         enable row level security;
alter table public.users         force  row level security;
alter table public.clinics       enable row level security;
alter table public.clinics       force  row level security;
alter table public.profiles      enable row level security;
alter table public.profiles      force  row level security;
alter table public.checkins      enable row level security;
alter table public.checkins      force  row level security;
alter table public.consents      enable row level security;
alter table public.consents      force  row level security;
alter table public.access_log    enable row level security;
alter table public.access_log    force  row level security;
alter table public.staff_invites enable row level security;
alter table public.staff_invites force  row level security;

-- public.users has NO policies: glowpt_app gets no grant on it at all, and only
-- the SECURITY DEFINER functions (bypassing RLS) ever touch it. Locked by design.

-- ---- clinics ----
-- Authenticated users see only their own clinic. The unauthenticated /join
-- lookup goes through get_clinic_by_slug(), not a blanket read.
create policy clinics_select_own on public.clinics
  for select to glowpt_app
  using (id = public.auth_clinic_id());

-- ---- profiles ----
-- NOTE: there is intentionally NO profiles_insert_self policy and NO app INSERT
-- grant. Profile rows are created only by register_user / provision_clinic /
-- join_clinic / accept_staff_invite (all SECURITY DEFINER). This closes the
-- symmetric "insert myself as manager" hole.
create policy profiles_select_self on public.profiles
  for select to glowpt_app
  using (id = public.current_user_id());
create policy profiles_select_clinic on public.profiles
  for select to glowpt_app
  using (public.auth_role() = 'manager' and clinic_id = public.auth_clinic_id());
create policy profiles_select_caseload on public.profiles
  for select to glowpt_app
  using (public.auth_role() = 'therapist' and therapist_id = public.current_user_id());
-- Hole 1 fix: row scoped here, COLUMN scoped by the grant below (full_name only).
create policy profiles_update_self on public.profiles
  for update to glowpt_app
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- ---- checkins ----
-- The 3 orphan V1 policies (incl. "Allow anonymous inserts for testing") are
-- intentionally absent. Hole 2 closed by their absence + the clinic_id check.
create policy checkins_insert_own on public.checkins
  for insert to glowpt_app
  with check (user_id = public.current_user_id() and clinic_id = public.auth_clinic_id());
create policy checkins_select_own on public.checkins
  for select to glowpt_app
  using (user_id = public.current_user_id());
create policy checkins_select_clinic on public.checkins
  for select to glowpt_app
  using (public.auth_role() = 'manager' and clinic_id = public.auth_clinic_id());
create policy checkins_select_caseload on public.checkins
  for select to glowpt_app
  using (public.auth_role() = 'therapist' and clinic_id = public.auth_clinic_id()
         and public.is_my_patient(user_id));
create policy checkins_update_own on public.checkins
  for update to glowpt_app
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id() and clinic_id = public.auth_clinic_id());

-- ---- consents ----
-- Q4: therapist read narrowed to caseload, consistent with profiles/checkins.
create policy consents_insert_own on public.consents
  for insert to glowpt_app
  with check (user_id = public.current_user_id());
create policy consents_select_own on public.consents
  for select to glowpt_app
  using (user_id = public.current_user_id());
create policy consents_select_clinic on public.consents
  for select to glowpt_app
  using (public.auth_role() = 'manager' and clinic_id = public.auth_clinic_id());
create policy consents_select_caseload on public.consents
  for select to glowpt_app
  using (public.auth_role() = 'therapist' and clinic_id = public.auth_clinic_id()
         and public.is_my_patient(user_id));

-- ---- access_log ----
create policy access_log_insert_own on public.access_log
  for insert to glowpt_app
  with check (actor_id = public.current_user_id());
create policy access_log_select_clinic on public.access_log
  for select to glowpt_app
  using (public.auth_role() = 'manager' and clinic_id = public.auth_clinic_id());

-- ---- staff_invites ----
create policy staff_invites_select_clinic on public.staff_invites
  for select to glowpt_app
  using (public.auth_role() = 'manager' and clinic_id = public.auth_clinic_id());


-- ============================ GRANTS ============================
-- glowpt_app: explicit, minimal, per-table. No table-wide grant-everything.
-- This is where Supabase's "anon/authenticated hold all 7 privileges" default
-- gets left behind on purpose (Rule 2). RLS is a second line, not the only one.
grant select                    on public.clinics       to glowpt_app;
grant select                    on public.profiles      to glowpt_app;
grant update (full_name)        on public.profiles      to glowpt_app;  -- Hole 1: column lock
grant select, insert, update    on public.checkins      to glowpt_app;
grant select, insert            on public.consents      to glowpt_app;
grant select, insert            on public.access_log    to glowpt_app;  -- append-only: no update/delete
grant select                    on public.staff_invites to glowpt_app;
-- No grant on public.profiles INSERT/DELETE, no grant on public.users at all.

-- glowpt_auth (internal definer role) needs DML on the tables its functions
-- touch. It is NOLOGIN, so this is only ever exercised through the functions.
grant select, insert, update on public.users         to glowpt_auth;
grant select, insert, update on public.clinics       to glowpt_auth;
grant select, insert, update on public.profiles      to glowpt_auth;
grant select, insert, update on public.consents      to glowpt_auth;
grant select, insert, update on public.staff_invites to glowpt_auth;

-- Functions: revoke the PUBLIC default, then grant EXECUTE explicitly.
revoke execute on all functions in schema public from public;
grant execute on function
  public.current_user_id(),
  public.auth_role(),
  public.auth_clinic_id(),
  public.is_my_patient(uuid),
  public.get_clinic_by_slug(text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text),
  public.accept_staff_invite(),
  public.invite_staff(text, text, text),
  public.assign_therapist(uuid, uuid),
  public.discharge_patient(uuid),
  public.restore_patient(uuid),
  public.register_user(uuid, citext, text)
to glowpt_app;


-- ============================ OWNERSHIP ============================
-- Tables -> glowpt_owner (non-bypass, so FORCE bites it). Functions ->
-- glowpt_auth (BYPASSRLS, so they do not recurse). Set explicitly so it holds
-- regardless of which role runs this script.
alter table public.users         owner to glowpt_owner;
alter table public.clinics       owner to glowpt_owner;
alter table public.profiles      owner to glowpt_owner;
alter table public.checkins      owner to glowpt_owner;
alter table public.consents      owner to glowpt_owner;
alter table public.access_log    owner to glowpt_owner;
alter table public.staff_invites owner to glowpt_owner;

alter function public.current_user_id()                       owner to glowpt_auth;
alter function public.auth_role()                             owner to glowpt_auth;
alter function public.auth_clinic_id()                        owner to glowpt_auth;
alter function public.is_my_patient(uuid)                     owner to glowpt_auth;
alter function public.get_clinic_by_slug(text)                owner to glowpt_auth;
alter function public.provision_clinic(text, text)            owner to glowpt_auth;
alter function public.join_clinic(text, text, text)           owner to glowpt_auth;
alter function public.accept_staff_invite()                   owner to glowpt_auth;
alter function public.invite_staff(text, text, text)          owner to glowpt_auth;
alter function public.assign_therapist(uuid, uuid)            owner to glowpt_auth;
alter function public.discharge_patient(uuid)                 owner to glowpt_auth;
alter function public.restore_patient(uuid)                   owner to glowpt_auth;
alter function public.register_user(uuid, citext, text)       owner to glowpt_auth;


-- ============================ PROPOSED, NOT APPLIED ============================
-- These are changes, not ports, so per the plan they are proposed for David's
-- decision rather than smuggled in. Uncomment only on an explicit "yes".
--
-- (P1) Make checkins.user_id NOT NULL. Every real check-in has an author; the
--      live column is nullable only because it predates the migrations. Safe if
--      no legitimate row ever has a null user_id.
--   alter table public.checkins alter column user_id set not null;
--
-- (P2) One-check-in-per-user-per-day at the DB level, closing the same-day
--      duplicate race that today relies on the app winning a read-then-write.
--      CAVEAT: "day" is timezone-dependent; this uses UTC date to match the
--      column's UTC default. Confirm that matches the product's notion of a day.
--   create unique index checkins_one_per_day
--     on public.checkins (user_id, ((created_at at time zone 'utc')::date));
