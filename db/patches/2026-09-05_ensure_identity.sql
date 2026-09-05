-- GlowPT patch, 2026-09-05: a signed-in account that has no public.users row.
--
-- WHAT WENT WRONG (found from a real invited patient, David's "Felix"):
--   1. He started an invite, reached the code screen, and walked away. That
--      leaves an UNCONFIRMED Cognito account behind.
--   2. On his next invite, SignUp threw UsernameExistsException, so
--      lib/cognito.js fell back to a normal sign-in. (The tell in the
--      screenshot: an EIGHT digit code. Sign-up codes are six.)
--   3. Sign-in never runs ConfirmSignUp, so the post-confirmation Lambda never
--      fired, so register_user never ran and he had NO public.users row.
--   4. accept_patient_invite then died on profiles_id_fkey. auth.jsx swallowed
--      the error, and he landed on "You're not connected to a clinic yet".
--
-- Reproduced before writing this: SQLSTATE 23503, profiles_id_fkey.
--
-- TWO CHANGES, AND THE ORDER MATTERS:
--   (a) The email guard in BOTH accept_*_invite functions now fails closed when
--       the caller has no users row. Before, `lower(inv.email) <> lower(NULL)`
--       was NULL rather than true, so the guard FELL THROUGH and only the
--       foreign key stopped the claim. Fixing (b) without (a) would have turned
--       a harmless fall-through into a real hole: any signed-in person could
--       have claimed any invite link.
--   (b) New ensure_self(), so the API can create the CALLER'S OWN identity row.
--       It takes no id, unlike register_user, so glowpt_app still cannot mint
--       an arbitrary identity.
--
-- Deletes nothing. Idempotent: safe to run twice.
-- Run over the bastion tunnel:
--   PGHOST=localhost PGPORT=5433 PGSSLMODE=require \
--   /Applications/Postgres.app/Contents/Versions/18/bin/psql \
--     -U glowpt_admin -d glowpt -v ON_ERROR_STOP=1 \
--     -f db/patches/2026-09-05_ensure_identity.sql

\set ON_ERROR_STOP on
begin;

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

alter function public.ensure_self(citext) owner to glowpt_auth;
-- ⚠️ REVOKE BEFORE GRANT. A newly created function carries an implicit EXECUTE
-- grant to PUBLIC. A fresh build strips it with the blanket
-- `revoke execute on all functions in schema public from public` near the foot
-- of schema.sql; a patch has no such sweep, so without this line the patched
-- database would hand ensure_self to every role (glowpt_weekly and
-- glowpt_postconfirm included) while a fresh build would not. Caught 2026-09-05
-- by diffing the rehearsed patch against a fresh build, which is why that
-- comparison is part of shipping a patch and not an optional extra.
revoke execute on function public.ensure_self(citext) from public;
grant execute on function public.ensure_self(citext) to glowpt_app;

-- ---- Guards: prove the patch did what it claims BEFORE committing. ----
do $guard$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'ensure_self';
  if n <> 1 then raise exception 'ensure_self missing (found %)', n; end if;

  if pg_get_functiondef('public.accept_patient_invite(text,text)'::regprocedure)
       not like '%v_email is null%'
     or pg_get_functiondef('public.accept_staff_invite(text)'::regprocedure)
       not like '%v_email is null%' then
    raise exception 'the email guard was not tightened on both doors';
  end if;

  if not has_function_privilege('glowpt_app', 'public.ensure_self(citext)', 'execute') then
    raise exception 'glowpt_app cannot execute ensure_self';
  end if;
  if has_function_privilege('public', 'public.ensure_self(citext)', 'execute') then
    raise exception 'ensure_self is still executable by PUBLIC';
  end if;

  -- The rule this patch must NOT break: the app role still cannot mint an
  -- identity for an arbitrary id.
  if has_function_privilege('glowpt_app', 'public.register_user(uuid,citext,text)', 'execute') then
    raise exception 'glowpt_app must NOT hold register_user';
  end if;

  raise notice 'GUARDS PASSED: ensure_self is live, both email guards fail closed,';
  raise notice 'GUARDS PASSED: glowpt_app holds ensure_self and still not register_user.';
end $guard$;

commit;
