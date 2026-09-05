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
--   glowpt_owner       : owns the tables. NOLOGIN, no bypass. FORCE applies to it too.
--   glowpt_auth        : owns the SECURITY DEFINER functions. NOLOGIN, BYPASSRLS.
--                        This is the trusted internal role (Supabase's "postgres").
--   glowpt_app         : the general app login role; the API Lambdas connect as
--                        this. Non-owner, minimal grants, fully subject to RLS.
--                        It CANNOT call register_user (cannot mint identities).
--   glowpt_postconfirm : the Cognito post-confirmation Lambda's own login role.
--                        EXECUTE on ONLY the four sign-up functions, nothing else.
--                        This is the least-privilege home for identity creation.
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
--   * Therefore table-owner and function-owner are split. glowpt_app and
--     glowpt_postconfirm are the two login roles, and RLS fully governs both.
--
-- Why a FOURTH role, glowpt_postconfirm (Phase 2 refinement):
--   * Identity creation (register_user) is the one privileged act that mints a
--     new users + profiles row. If the general app role could do it, a bug or a
--     stolen glowpt_app credential could create arbitrary identity rows.
--   * So identity creation gets its OWN login role, used by nothing but the
--     Cognito post-confirmation Lambda. It holds EXECUTE on exactly the four
--     sign-up functions (register_user + the three attach RPCs) and NOTHING
--     else: no table grants, no other functions. glowpt_app loses register_user.
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
    create role glowpt_app login;          -- password set out of band
  end if;
  if not exists (select from pg_roles where rolname = 'glowpt_postconfirm') then
    create role glowpt_postconfirm login;  -- password set out of band
  end if;
  if not exists (select from pg_roles where rolname = 'glowpt_weekly') then
    create role glowpt_weekly login;       -- password set out of band
  end if;
end $$;

-- The role running this script must be a member of these roles to reassign
-- ownership to them below.
grant glowpt_owner, glowpt_auth, glowpt_app to current_user;

-- Leave Supabase's wide-open default posture behind (Rule 2 spirit).
revoke all on schema public from public;
grant usage on schema public to glowpt_app, glowpt_auth, glowpt_owner, glowpt_postconfirm, glowpt_weekly;


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
-- baa_signed_at and activated_at are TWO facts on purpose: the first is the
-- legal record of a signature, the second is the gate that lets a clinic enrol
-- patients. Usually flipped together, but a demo clinic is active with no BAA,
-- and a clinic can sign before it is switched on. One column would force a lie.
create table public.clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  baa_signed_at timestamptz,
  baa_version   text,
  activated_at  timestamptz,                      -- null = closed, no PHI accepted
  activated_by  uuid references public.users(id),
  created_at    timestamptz not null default now(),
  -- How patients get in. FALSE (the default, so a new clinic is never exposed
  -- by accident) means invite only: the /join/<slug> link and its QR refuse
  -- everyone, and a patient arrives solely through a manager's invite link.
  -- TRUE restores the self-serve walk-in path, for a clinic that genuinely
  -- wants a code on the front desk.
  --
  -- ⚠️ This is a THIRD, separate flag from activated_at and baa_signed_at, and
  -- deliberately so: activation is "may this clinic operate at all", this is
  -- "how does it enrol", and they move for entirely different reasons.
  --
  -- Declared LAST on purpose: a patch can only append a column, so keeping it
  -- last here is what makes a migrated database and a fresh one identical.
  open_signup   boolean not null default false
);

-- ---- public.profiles (PHI: names a person as a patient of a clinic) ----
-- Cross-clinic operator identity (David). Deliberately NOT a profiles role:
-- profiles are clinic-scoped and every RLS policy assumes it. RLS is enabled
-- and FORCEd with NO policies and no grant to glowpt_app, so the table is
-- invisible to the application role — only the definer functions below read it,
-- which means a compromised app role cannot make itself an admin.
create table public.platform_admins (
  user_id  uuid primary key references public.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

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

-- ---- public.staff_invites (invites; the name is historical) ----
-- ⚠️ THIS TABLE NOW HOLDS PATIENT INVITES TOO, so it is no longer PHI-free: a
-- patient row names a person as a patient of a named clinic, which is exactly
-- what makes public.profiles PHI. It was already RLS-scoped to the clinic's own
-- manager, which is the right scoping either way. The table keeps its name
-- because renaming it would churn every policy, grant and function for no gain.
--
-- 256 bits of randomness, hex, from two v4 uuids. gen_random_uuid() is built in
-- from PG13, so this needs no extension. Defined above the table because a
-- column DEFAULT is parsed at CREATE TABLE time and the function must exist.
create or replace function public.new_invite_token() returns text
  language sql volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create table public.staff_invites (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'therapist' check (role in ('patient','therapist','manager')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  -- The invite LINK the manager sends. ⚠️ The token says WHICH invite; it does
  -- NOT grant the role. accept_staff_invite additionally requires the signed-in
  -- user's verified email to equal this row's email, so a forwarded link is
  -- useless to anyone else. Re-inviting mints a fresh token, which is what
  -- invalidates a link that was sent to the wrong place.
  token      text not null default public.new_invite_token(),
  expires_at timestamptz not null default now() + interval '14 days',
  unique (clinic_id, email)
);
create index staff_invites_email_idx on public.staff_invites (email) where (consumed_at is null);
-- A unique INDEX rather than an inline unique CONSTRAINT so that a database
-- built fresh from this file and one migrated by db/patches/2026-09-04_staff_
-- invite_tokens.sql end up byte-identical: a patch cannot add a constraint
-- idempotently, but `create unique index if not exists` is re-runnable.
create unique index staff_invites_token_key on public.staff_invites (token);


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

-- The activation gate's reader. Same shape as the three helpers around it: a
-- policy that reads clinics under FORCE RLS must not re-enter RLS or it recurses.
create or replace function public.clinic_is_active(p_clinic uuid) returns boolean
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$
  select exists (
    select 1 from public.clinics
    where id = p_clinic and activated_at is not null
  )
$$;

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

-- ensure_self: create the CALLER'S OWN identity row if it is missing.
--
-- ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT register_user.
-- lib/cognito.js falls back to a normal sign-in when Cognito reports the email
-- already has an account. Sign-in never runs ConfirmSignUp, so the
-- post-confirmation Lambda never fires, so register_user never runs and the
-- account has NO public.users row. Every attach RPC then dies on the profiles
-- foreign key, and the person lands on the NoClinic screen with no idea why.
-- (Found 2026-09-05 from a real invited patient who had abandoned an earlier
-- invite at the code screen, leaving an unconfirmed Cognito account behind.)
--
-- ⛔ THE DIFFERENCE FROM register_user IS THE WHOLE POINT. register_user takes
-- an arbitrary id and so can mint ANY identity, which is exactly why glowpt_app
-- must never hold it (see the grant block near the foot of this file). This one
-- takes NO id: it uses current_user_id(), which comes from the verified Cognito
-- sub the API set with set_config. So the app role can only ever create a row
-- for the caller who is already authenticated, never for anyone else. Keep it
-- that way: do not add an id parameter, and do not grant register_user instead.
create or replace function public.ensure_self(p_email citext)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_id uuid := public.current_user_id();
begin
  if v_id is null then raise exception 'Not authenticated'; end if;
  if p_email is null or btrim(p_email::text) = '' then
    raise exception 'An email address is required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.users where id = v_id) then return; end if;

  begin
    insert into public.users (id, email) values (v_id, lower(p_email));
  exception when unique_violation then
    -- users.email is UNIQUE, so landing here means this address already belongs
    -- to a DIFFERENT subject id: two Cognito accounts for one address. Refuse
    -- loudly. Silently attaching would hand one person another's clinic row.
    raise exception 'This email address is already registered to another account'
      using errcode = 'P0001';
  end;

  -- A bare profile, exactly as register_user leaves one: role defaults to
  -- 'patient' with no clinic, and whichever attach RPC runs next overwrites it.
  insert into public.profiles (id) values (v_id) on conflict (id) do nothing;
end $$;

-- get_clinic_by_slug: the ONLY unauthenticated data read in the app (a new
-- patient with no account resolving their clinic from /join/<slug>). Replaces
-- the old clinics "USING (true)" blanket, which exposed the entire customer
-- list. This returns exactly one clinic's public fields for one slug.
-- is_active lets the public /join page tell "no such clinic" apart from "not
-- open yet", so a patient reads a sentence instead of hitting a thrown error.
create or replace function public.get_clinic_by_slug(p_slug text)
  returns table (id uuid, name text, slug text, is_active boolean, open_signup boolean)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.id, c.name, c.slug, (c.activated_at is not null) as is_active, c.open_signup
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

  -- The activation gate. Enforced here, not in the UI, so it holds regardless
  -- of what the frontend does or whether the frontend is the caller at all.
  if not public.clinic_is_active(v_clinic) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  -- The self-serve gate. This function IS the open /join/<slug> path, so a
  -- clinic that has not asked for a walk-in QR refuses strangers here, in the
  -- database. An INVITED patient never reaches this function: they arrive
  -- through accept_patient_invite, which is matched to their own address.
  if not (select open_signup from public.clinics where id = v_clinic) then
    raise exception 'This clinic is invite only' using errcode = 'P0001';
  end if;

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

-- Claim a staff invite and become therapist/manager of its clinic.
--
-- ⚠️ THE TOKEN IS NOT THE CREDENTIAL. It says WHICH invite is being claimed; the
-- gate is that the signed-in user's VERIFIED email must equal the invited email.
-- So a forwarded or leaked invite link grants nothing: the wrong person signing
-- up with it is refused here, in the database, whatever the frontend does. The
-- role likewise comes off the invite row, never from anything the caller sends.
--
-- p_token null is the FRONTEND SAFETY NET (auth.jsx re-runs this blind on first
-- sign-in when the post-confirmation Lambda may have missed). That path matches
-- on email alone and returns null rather than raising, because it is a
-- speculative retry for a user who usually has no invite at all.
create or replace function public.accept_staff_invite(p_token text default null)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email text; v_inv record;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  select email from public.users where id = public.current_user_id() into v_email;

  if p_token is not null then
    select * from public.staff_invites
      where token = p_token and consumed_at is null and expires_at > now()
      into v_inv;
    -- Loud, because someone followed a link and deserves to know why it failed.
    if v_inv.id is null then
      raise exception 'This invite link is no longer valid' using errcode = 'P0001';
    end if;
    -- ⚠️ `v_email is null` is load-bearing, not defensive noise. Without it a
    -- caller with no public.users row compares against NULL, the whole
    -- condition is NULL rather than true, and this guard FALLS THROUGH. The
    -- doc's promise that an invite link is safe to forward rests on this
    -- check, so it must fail closed. (Until 2026-09-05 only the profiles
    -- foreign key stopped that case, which is a backstop, not the guarantee.)
    if v_email is null or lower(v_inv.email) <> lower(v_email) then
      raise exception 'This invite is for a different email address' using errcode = 'P0001';
    end if;
    -- ⚠️ A patient invite must NOT be claimed here: this function records no
    -- consent, and a patient attached without a consents row is exactly the
    -- gap the privacy notice exists to close. accept_patient_invite is the
    -- only door for those.
    if v_inv.role = 'patient' then
      raise exception 'Use the patient invite flow for this invite' using errcode = 'P0001';
    end if;
  else
    -- The blind safety net. Staff roles only, for the same consent reason: a
    -- patient invite is never claimed by a speculative retry.
    select * from public.staff_invites
      where email = lower(v_email) and consumed_at is null and expires_at > now()
        and role <> 'patient'
      order by created_at desc limit 1 into v_inv;
    if v_inv.id is null then return null; end if;
  end if;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_inv.clinic_id, v_inv.role, v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = v_inv.role,
          full_name = coalesce(public.profiles.full_name, v_inv.full_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- Returns the invite TOKEN so the caller can build the link to send. Re-inviting
-- the same address mints a FRESH token and a fresh expiry and clears consumed_at
-- — that is deliberately how a link sent to the wrong place gets invalidated.
create or replace function public.invite_staff(
    p_email text, p_full_name text, p_role text default 'therapist')
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, public.current_user_id())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Read an invite by its token, WITHOUT being signed in, so the sign-up screen
-- can say which clinic and which role before the person has an account. Serves
-- patient AND staff invites; the caller branches on the role it returns.
-- Same unauthenticated shape as get_clinic_by_slug. It reveals the invited email
-- to whoever holds the token, which is the point of an invite link; the token is
-- the secret, and holding it still does not let the wrong person claim the role.
-- An unknown, expired or already-used token returns zero rows.
create or replace function public.get_staff_invite(p_token text)
  returns table (clinic_name text, clinic_slug text, email text, full_name text, role text)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.name, c.slug, i.email, i.full_name, i.role
    from public.staff_invites i
    join public.clinics c on c.id = i.clinic_id
   where i.token = p_token
     and i.consumed_at is null
     and i.expires_at > now()
$$;

-- Invite a PATIENT by email. Same token machinery as invite_staff and the same
-- guarantee: the token says which invite, the verified email is the gate. Split
-- from invite_staff rather than folded into it so a patient form can never be
-- coaxed into minting a therapist or manager invite by passing a role.
create or replace function public.invite_patient(p_email text, p_full_name text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite patients'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), 'patient', public.current_user_id())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = 'patient',
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Claim a PATIENT invite. The twin of accept_staff_invite, plus the one thing
-- that door cannot do: record consent, in the same transaction as the attach.
-- Role is pinned to 'patient' here rather than read off the invite, so even a
-- tampered invite row cannot mint staff through the patient screen.
create or replace function public.accept_patient_invite(p_token text, p_consent_version text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email text; v_inv record;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  select email from public.users where id = public.current_user_id() into v_email;

  select * from public.staff_invites
    where token = p_token and consumed_at is null and expires_at > now()
    into v_inv;
  if v_inv.id is null then
    raise exception 'This invite link is no longer valid' using errcode = 'P0001';
  end if;
  -- See the note in accept_staff_invite: without the null test this guard
  -- falls through for a caller who has no public.users row.
  if v_email is null or lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invite is for a different email address' using errcode = 'P0001';
  end if;
  if v_inv.role <> 'patient' then
    raise exception 'Use the staff invite flow for this invite' using errcode = 'P0001';
  end if;

  -- An invited patient is enrolling in a clinic, so the activation gate applies
  -- exactly as it does on the open path. An invite is not a way around it.
  if not public.clinic_is_active(v_inv.clinic_id) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_inv.clinic_id, 'patient', v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = 'patient',
          full_name = coalesce(public.profiles.full_name, v_inv.full_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_inv.clinic_id, 'hipaa_patient_ack', p_consent_version);
  end if;

  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- The manager's own switch: does this clinic take walk-ins, or invites only.
-- Theirs rather than the platform admin's, because only they know whether they
-- want a code on the front desk.
create or replace function public.set_clinic_open_signup(p_open boolean)
  returns boolean
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can change patient sign-up'; end if;
  update public.clinics set open_signup = p_open where id = v_clinic;
  return p_open;
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

-- A manager cancels a pending invite for their own clinic. Consumed invites are
-- left alone: that person is already in, and cancelling their invite row would
-- be a lie about how they got there.
create or replace function public.revoke_invite(p_email text)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles
    where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can cancel an invite'; end if;

  delete from public.staff_invites
   where clinic_id = v_clinic
     and lower(email) = lower(p_email)
     and consumed_at is null;
  if not found then raise exception 'No pending invite for that email address'; end if;
end $$;

-- Permanently remove a patient who should never have been enrolled.
--
-- ⛔ THREE GUARDS, ALL LOAD-BEARING. (1) manager of that clinic only; (2) the
-- patient must already be DISCHARGED, so this can never be a one-click action
-- from the main roster even if a future screen puts a button there; (3) ZERO
-- check-ins, which is what keeps this a purge of mistakes rather than a delete
-- of records. Do not relax (3) without a conversation about retention — many
-- states require PT records be kept for years, and the BAA (§5.4) already
-- describes destruction as something that happens at termination, on request,
-- with a process.
--
-- Deleting the users row cascades profiles and consents. It does NOT erase audit
-- history: access_log.target_user_id carries no foreign key, and access_log
-- actors are staff and admins, never patients.
--
-- ⚠️ The Cognito account is NOT deleted — the API has no admin rights over the
-- pool. That person keeps a login that now resolves to no clinic, so they land
-- on the NoClinic screen and cannot see anything. Re-inviting the same address
-- later works, because the invite flow already handles an existing account.
create or replace function public.purge_patient(p_patient uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_checkins integer; v_discharged timestamptz;
begin
  select clinic_id from public.profiles
    where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can remove a patient'; end if;
  if p_patient = public.current_user_id() then raise exception 'You cannot remove yourself'; end if;

  select discharged_at from public.profiles
   where id = p_patient and clinic_id = v_clinic and role = 'patient' into v_discharged;
  if not found then raise exception 'Patient not in your clinic'; end if;
  if v_discharged is null then
    raise exception 'Discharge this patient first. Removing is permanent.';
  end if;

  select count(*) from public.checkins where user_id = p_patient into v_checkins;
  if v_checkins > 0 then
    raise exception 'This patient has % check-in(s), so their record is kept. Leave them discharged instead.', v_checkins;
  end if;

  -- Cascades profiles and consents. Their pending/consumed invite row is keyed
  -- by email and is removed too, so the address is clean to re-invite.
  delete from public.staff_invites
   where clinic_id = v_clinic
     and lower(email) = (select lower(email) from public.users where id = p_patient);
  delete from public.users where id = p_patient;
end $$;


-- weekly_summary_rows: the cross-clinic read for the weekly-summary Lambda (SES +
-- EventBridge, fires Mondays). Unlike every other read, this is a trusted batch
-- job that legitimately spans ALL clinics; glowpt_app is RLS-scoped to one user
-- and cannot serve it. So it runs as glowpt_auth (BYPASSRLS) and is callable ONLY
-- by the dedicated glowpt_weekly login role (grant below; NOT granted to
-- glowpt_app). Returns one row per email RECIPIENT: role='patient' rows drive the
-- personal nudge (own first name + own 7-day count), role in
-- ('manager','therapist') rows drive the clinic aggregate summary. The per-clinic
-- scoping and aggregates are all computed in SQL (GROUP BY), never a JS array
-- filter -- that filter was the old function's cross-tenant-leak risk. Discharged
-- people and clinic-less profiles are excluded; the window is check-ins in the
-- last 7 days counted as distinct UTC calendar days per patient.
create or replace function public.weekly_summary_rows()
  returns table (
    clinic_id              uuid,
    clinic_name            text,
    recipient_id           uuid,
    email                  citext,
    full_name              text,
    role                   text,
    checkin_days           integer,
    clinic_total_patients  integer,
    clinic_active_patients integer
  )
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$
  with recent as (
    select ch.user_id,
           -- distinct UTC calendar days; same rule as public.utc_date(), inlined
           -- to keep this function free of any create-order / grant dependency.
           count(distinct (ch.created_at at time zone 'UTC')::date)::int as days
    from public.checkins ch
    where ch.created_at >= now() - interval '7 days'
    group by ch.user_id
  ),
  patients as (
    select p.clinic_id,
           p.id                as recipient_id,
           u.email,
           p.full_name,
           coalesce(r.days, 0) as checkin_days
    from public.profiles p
    join public.users u on u.id = p.id
    left join recent r  on r.user_id = p.id
    where p.role = 'patient'
      and p.discharged_at is null
      and p.clinic_id is not null
  ),
  agg as (
    select clinic_id,
           count(*)::int                                 as total,
           count(*) filter (where checkin_days > 0)::int as active
    from patients
    group by clinic_id
  )
  select c.id, c.name, pt.recipient_id, pt.email, pt.full_name,
         'patient'::text, pt.checkin_days, a.total, a.active
  from patients pt
  join public.clinics c on c.id = pt.clinic_id
  join agg a            on a.clinic_id = pt.clinic_id
  union all
  select c.id, c.name, sp.id, u.email, sp.full_name,
         sp.role, 0, coalesce(a.total, 0), coalesce(a.active, 0)
  from public.profiles sp
  join public.users u   on u.id = sp.id
  join public.clinics c on c.id = sp.clinic_id
  left join agg a       on a.clinic_id = sp.clinic_id
  where sp.role in ('manager','therapist')
    and sp.discharged_at is null
$$;


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
alter table public.platform_admins enable row level security;
alter table public.platform_admins force  row level security;

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
-- clinic_is_active: blocking only the join would still let an already-attached
-- patient write PHI to a clinic that was never switched on (or was switched off).
create policy checkins_insert_own on public.checkins
  for insert to glowpt_app
  with check (user_id = public.current_user_id()
              and clinic_id = public.auth_clinic_id()
              and public.clinic_is_active(clinic_id));
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
  with check (user_id = public.current_user_id()
              and clinic_id = public.auth_clinic_id()
              and public.clinic_is_active(clinic_id));

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
grant select                 on public.checkins      to glowpt_auth;  -- read-only: weekly_summary_rows counts them
grant select                 on public.platform_admins to glowpt_auth;  -- is_platform_admin() reads it
grant select, insert         on public.access_log    to glowpt_auth;  -- admin_* functions log their own actions

-- ⚠️ THE ONLY DELETE RIGHTS IN THE APP, and deliberately just these two tables.
-- Everything else glowpt_auth can do is select/insert/update, because until
-- 2026-09-05 nothing in GlowPT deleted anything. purge_patient needs them to
-- remove a patient enrolled by mistake; revoke_invite needs the invite one to
-- cancel a pending invite. Postgres performs ON DELETE CASCADE with the table
-- owner's rights, not the caller's, so removing a users row still clears
-- profiles/consents/checkins without granting delete on any of those.
grant delete on public.users         to glowpt_auth;
grant delete on public.staff_invites to glowpt_auth;

-- ========================= PLATFORM ADMIN (cross-clinic) =========================
-- The operator surface. Clinic-level only: counts and timestamps, never a
-- patient name or check-in body, so no PHI crosses a clinic boundary. Every one
-- re-checks is_platform_admin() itself — the caller's identity is never trusted
-- from a parameter, same rule as every other RPC here.

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$
  select exists (
    select 1 from public.platform_admins where user_id = public.current_user_id()
  )
$$;

-- Manager contact IS included: operating the switch means emailing the clinic,
-- and a clinic manager's work email is not patient health information.
create or replace function public.admin_list_clinics()
  returns table (
    id              uuid,
    name            text,
    slug            text,
    created_at      timestamptz,
    activated_at    timestamptz,
    baa_signed_at   timestamptz,
    baa_version     text,
    manager_name    text,
    manager_email   text,
    patient_count   bigint,
    staff_count     bigint,
    checkins_7d     bigint,
    last_checkin_at timestamptz
  )
  language plpgsql stable security definer
  set search_path = public set row_security = off
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
    select c.id, c.name, c.slug, c.created_at, c.activated_at,
           c.baa_signed_at, c.baa_version,
           m.full_name, mu.email::text,   -- users.email is citext; the return type is text
           (select count(*) from public.profiles p
             where p.clinic_id = c.id and p.role = 'patient' and p.discharged_at is null),
           (select count(*) from public.profiles p
             where p.clinic_id = c.id and p.role in ('manager', 'therapist')),
           (select count(*) from public.checkins k
             where k.clinic_id = c.id and k.created_at > now() - interval '7 days'),
           (select max(k.created_at) from public.checkins k where k.clinic_id = c.id)
    from public.clinics c
    left join lateral (
      select p.id, p.full_name from public.profiles p
      where p.clinic_id = c.id and p.role = 'manager'
      order by p.id limit 1
    ) m on true
    left join public.users mu on mu.id = m.id
    order by c.created_at desc;
end $$;

-- Flipping OFF is deliberately allowed: if something goes wrong at a clinic,
-- stopping new PHI must not require a deploy.
create or replace function public.admin_set_clinic_active(p_clinic uuid, p_active boolean)
  returns timestamptz
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_now timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if p_active then
    v_now := now();
    update public.clinics
       set activated_at = coalesce(activated_at, v_now),
           activated_by = public.current_user_id()
     where id = p_clinic
    returning activated_at into v_now;
  else
    update public.clinics
       set activated_at = null,
           activated_by = public.current_user_id()
     where id = p_clinic
    returning activated_at into v_now;
  end if;

  if not found then raise exception 'Clinic not found'; end if;

  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), p_clinic,
          case when p_active then 'clinic_activated' else 'clinic_deactivated' end);

  return v_now;
end $$;

-- Recording the signature is separate from opening the gate, on purpose.
create or replace function public.admin_record_baa(p_clinic uuid, p_version text)
  returns timestamptz
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_now timestamptz := now();
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  update public.clinics
     set baa_signed_at = v_now, baa_version = p_version
   where id = p_clinic;
  if not found then raise exception 'Clinic not found'; end if;

  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), p_clinic, 'baa_recorded');

  return v_now;
end $$;

-- Functions: revoke the PUBLIC default, then grant EXECUTE explicitly.
-- NOTE: register_user is deliberately ABSENT from glowpt_app's list. Identity
-- creation from an ARBITRARY id belongs to glowpt_postconfirm alone (granted
-- just below). glowpt_app gets ensure_self instead, which can only ever create
-- a row for the already-authenticated caller (see its comment above). The three
-- attach RPCs (provision_clinic / join_clinic / accept_staff_invite) DO stay on
-- glowpt_app as well, since the frontend re-runs them as an idempotent safety
-- net on first sign-in if the post-confirmation Lambda ever missed.
revoke execute on all functions in schema public from public;
grant execute on function
  public.current_user_id(),
  public.auth_role(),
  public.auth_clinic_id(),
  public.is_my_patient(uuid),
  public.get_clinic_by_slug(text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text),
  public.accept_staff_invite(text),
  public.get_staff_invite(text),
  public.invite_staff(text, text, text),
  public.invite_patient(text, text),
  public.accept_patient_invite(text, text),
  public.ensure_self(citext),
  public.set_clinic_open_signup(boolean),
  public.assign_therapist(uuid, uuid),
  public.discharge_patient(uuid),
  public.restore_patient(uuid),
  public.revoke_invite(text),
  public.purge_patient(uuid),
  public.clinic_is_active(uuid),
  public.is_platform_admin(),
  public.admin_list_clinics(),
  public.admin_set_clinic_active(uuid, boolean),
  public.admin_record_baa(uuid, text)
to glowpt_app;

-- glowpt_postconfirm: the Cognito post-confirmation Lambda's role. It may run
-- ONLY the four sign-up functions and touches no table directly (all its work
-- goes through these SECURITY DEFINER functions, owned by glowpt_auth). It is
-- the ONLY role that can call register_user. current_user_id() is not granted:
-- the Lambda sets app.user_id via the set_config() built-in, and the attach RPCs
-- read it internally as their definer, not as glowpt_postconfirm.
grant execute on function
  public.register_user(uuid, citext, text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text),
  public.accept_staff_invite(text),
  public.accept_patient_invite(text, text)
to glowpt_postconfirm;

-- glowpt_weekly: the weekly-summary Lambda's role. It has NO table grants and can
-- call exactly ONE function, the cross-clinic read below. Deliberately NOT granted
-- to glowpt_app: that would let any patient read every clinic's data. (The blanket
-- "revoke execute ... from public" above already stripped the default PUBLIC grant
-- off weekly_summary_rows, so this is the only path to it.)
grant execute on function public.weekly_summary_rows() to glowpt_weekly;

-- Phase 3 note (self-heal edge, parked deliberately): the frontend safety-net
-- re-attach runs as glowpt_app, which can call join_clinic / accept_staff_invite
-- but NOT register_user. Those RPCs insert into profiles, whose id FK-references
-- users(id). So they self-heal a partial post-confirm (identity row created,
-- attach missed) but NOT a total post-confirm miss (no users row at all). The
-- Phase 3 API's first-sign-in path must therefore be able to ensure the identity
-- row (e.g. invoke register_user through the post-confirm capability), not rely
-- on glowpt_app alone. Recorded here so it is designed, not discovered.


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
alter table public.platform_admins owner to glowpt_owner;

alter function public.current_user_id()                       owner to glowpt_auth;
alter function public.auth_role()                             owner to glowpt_auth;
alter function public.auth_clinic_id()                        owner to glowpt_auth;
alter function public.is_my_patient(uuid)                     owner to glowpt_auth;
alter function public.get_clinic_by_slug(text)                owner to glowpt_auth;
alter function public.provision_clinic(text, text)            owner to glowpt_auth;
alter function public.join_clinic(text, text, text)           owner to glowpt_auth;
alter function public.accept_staff_invite(text)               owner to glowpt_auth;
alter function public.invite_staff(text, text, text)          owner to glowpt_auth;
alter function public.invite_patient(text, text)              owner to glowpt_auth;
alter function public.accept_patient_invite(text, text)       owner to glowpt_auth;
alter function public.set_clinic_open_signup(boolean)         owner to glowpt_auth;
alter function public.get_staff_invite(text)                         owner to glowpt_auth;
alter function public.new_invite_token()                      owner to glowpt_auth;
alter function public.assign_therapist(uuid, uuid)            owner to glowpt_auth;
alter function public.discharge_patient(uuid)                 owner to glowpt_auth;
alter function public.restore_patient(uuid)                   owner to glowpt_auth;
alter function public.register_user(uuid, citext, text)       owner to glowpt_auth;
alter function public.ensure_self(citext)                     owner to glowpt_auth;
alter function public.weekly_summary_rows()                   owner to glowpt_auth;
alter function public.clinic_is_active(uuid)                  owner to glowpt_auth;
alter function public.is_platform_admin()                     owner to glowpt_auth;
alter function public.admin_list_clinics()                    owner to glowpt_auth;
alter function public.admin_set_clinic_active(uuid, boolean)  owner to glowpt_auth;
alter function public.admin_record_baa(uuid, text)            owner to glowpt_auth;
alter function public.revoke_invite(text)                     owner to glowpt_auth;
alter function public.purge_patient(uuid)                     owner to glowpt_auth;


-- ============================ INTEGRITY TIGHTENINGS (approved by David 2026-08-07) ============================
-- Improvements over the live Supabase schema, not faithful ports. Applied on an
-- empty schema, so no backfill concerns.

-- (P1) Every check-in must have an author. The live column was nullable only
--      because checkins predates the migrations. The app path already always
--      sets user_id (RLS requires user_id = current_user_id()); this is the
--      defense-in-depth backstop for any non-app code path.
alter table public.checkins alter column user_id set not null;

-- (P2) One check-in per user per (UTC) calendar day, enforced in the database so
--      the same-day re-entry logic no longer relies on the app winning a
--      read-then-write race. The app's same-day path UPDATEs the existing row
--      rather than inserting, so it is unaffected; this only blocks true dups.
--
--      "UTC day" needs an IMMUTABLE expression for the index. `created_at AT TIME
--      ZONE 'UTC'` is only STABLE (timezone rules can change in general), so
--      Postgres rejects it directly. For the FIXED 'UTC' zone the result is
--      genuinely constant, so we wrap it in an IMMUTABLE helper (the standard
--      idiom) and index on that.
create or replace function public.utc_date(ts timestamptz) returns date
  language sql immutable
as $$ select (ts at time zone 'UTC')::date $$;
grant execute on function public.utc_date(timestamptz) to glowpt_app;

create unique index checkins_one_per_day
  on public.checkins (user_id, public.utc_date(created_at));
