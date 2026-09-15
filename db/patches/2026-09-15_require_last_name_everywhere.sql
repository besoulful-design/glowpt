-- ============================================================================
-- 2026-09-15 — a last name is required for EVERY user, not just patients.
--
-- WHY (David, on reading the /onboard form): "We need to be able to identify
-- patients and staff and any users by first and last name. Clinics have too
-- many patients and staff with same names so both should always be required."
-- The old rule exempted staff because they are not on the patient roster that
-- two identical first names break. That was too narrow -- a clinic has as many
-- Sarahs on the care team as in the caseload, and staff are named in the
-- therapist picker, the invited list and the weekly email.
--
-- WHAT IT CHANGES: two functions gain the same pair of guards invite_patient
-- has carried since 2026-09-13.
--   invite_staff  -- a manager can no longer invite a colleague with no surname
--   join_clinic   -- the self-serve /join/<slug> door, which no live clinic has
--                    switched on, so this costs nothing today and keeps the
--                    guarantee true if one ever does
--   invite_patient -- BEHAVIOR UNCHANGED, it already required both. It is here
--                    only so its stored body matches db/schema.sql, where one
--                    comment inside it now names the new rule. Caught by
--                    diffing the rehearsed patch against a fresh build, which
--                    is the whole reason that step exists.
--
-- ⛔ WHAT IT DOES NOT DO, DELIBERATELY:
--   * The COLUMNS stay nullable. Rows created before today have a first name
--     only (three patients, and any staff invited before this), and they are
--     not being deleted or blocked. Every door that makes a NEW user refuses
--     without both parts; the old rows are corrected by hand, a patient through
--     rename_patient and a staff member not at all yet.
--   * register_user is untouched. It runs from the post-confirmation Lambda
--     with whatever Cognito metadata carries, and for an INVITED person the
--     names arrive from the invite row a moment later through accept_*_invite.
--     A guard there would refuse sign-ups the invite doors have already vetted.
--
-- SAFE TO RUN: replaces two functions, changes no data, drops nothing, and is
-- re-runnable. It only ever REFUSES calls that used to succeed, so the frontend
-- and API that stop making those calls must deploy FIRST (they did, in the same
-- push) -- otherwise a manager inviting staff with no surname would meet a raw
-- database error instead of a form message.
--
-- ⚠️ A PATCH LEAVES A NEW FUNCTION EXECUTABLE BY PUBLIC; A FRESH BUILD DOES
-- NOT. create-or-replace preserves the existing ACL, so this is belt and
-- braces, but the guards below assert the end state either way.
--
-- ⚠️ BOTH BODIES ARE LIFTED VERBATIM FROM db/schema.sql, not retyped. That is
-- the rule since 2026-09-13, when a retyped patch silently dropped a function.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- 1. join_clinic: both names required.
-- ---------------------------------------------------------------------------
-- join_clinic: replaces the client-side profile upsert in the patient join flow.
-- Role is pinned to 'patient' server-side; clinic resolved from the slug; a
-- staff member is refused, not downgraded; consent written in the same txn.
create or replace function public.join_clinic(
    p_slug text, p_first_name text, p_last_name text, p_consent_version text)
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

  -- Both parts are required, like every other door that creates a user
  -- (2026-09-15). This is the self-serve /join/<slug> path, which no live
  -- clinic has switched on, so the check costs nothing today and keeps the
  -- guarantee true if one ever does.
  if nullif(btrim(p_first_name), '') is null then
    raise exception 'A first name is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_last_name), '') is null then
    raise exception 'A last name is required' using errcode = 'P0001';
  end if;

  -- coalesce keeps a name the person already has rather than blanking it,
  -- exactly as it did when this was one column. Each part is kept separately,
  -- so someone who had a first name but no last one gains the last one here.
  insert into public.profiles (id, clinic_id, role, first_name, last_name)
    values (public.current_user_id(), v_clinic, 'patient',
            nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''))
    on conflict (id) do update
      set clinic_id  = v_clinic,
          role       = 'patient',
          first_name = coalesce(public.profiles.first_name, excluded.first_name),
          last_name  = coalesce(public.profiles.last_name,  excluded.last_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_clinic, 'hipaa_patient_ack', p_consent_version);
  end if;

  return v_clinic;
end $$;

alter function public.join_clinic(text, text, text, text) owner to glowpt_auth;
revoke execute on function public.join_clinic(text, text, text, text) from public;
grant  execute on function public.join_clinic(text, text, text, text) to glowpt_app;

-- ---------------------------------------------------------------------------
-- 2. invite_staff: both names required, exactly as invite_patient already is.
-- ---------------------------------------------------------------------------
-- Returns the invite TOKEN so the caller can build the link to send. Re-inviting
-- the same address mints a FRESH token and a fresh expiry and clears consumed_at
-- — that is deliberately how a link sent to the wrong place gets invalidated.
-- ⚠️ NO DEFAULT ON p_role, for the same reason as register_user above: with
-- one, a 3-argument call would have matched both this and the old
-- invite_staff(text, text, text) during the rollout window. Callers pass the
-- role explicitly.
create or replace function public.invite_staff(
    p_email text, p_first_name text, p_last_name text, p_role text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  -- ⚠️ BOTH NAMES ARE REQUIRED HERE TOO, AS OF 2026-09-15 (David's call). Until
  -- then a staff surname was optional, on the reasoning that staff are not on
  -- the patient roster two identical first names break. That was too narrow: a
  -- clinic has as many Sarahs on the care team as in the caseload, and the
  -- assignment picker, the invite list and the weekly email all name staff. So
  -- every user in the system now carries both parts, and this door and
  -- invite_patient hold the same line. A clinician who goes by "PT Pete" still
  -- gets that verbatim in the first box; the surname is the identifier beside it.
  if nullif(btrim(p_first_name), '') is null then
    raise exception 'A first name is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_last_name), '') is null then
    raise exception 'A last name is required' using errcode = 'P0001';
  end if;
  insert into public.staff_invites (clinic_id, email, first_name, last_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), btrim(p_first_name),
          btrim(p_last_name), p_role, public.current_user_id())
  on conflict (clinic_id, email) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

alter function public.invite_staff(text, text, text, text) owner to glowpt_auth;
revoke execute on function public.invite_staff(text, text, text, text) from public;
grant  execute on function public.invite_staff(text, text, text, text) to glowpt_app;

-- ---------------------------------------------------------------------------
-- 3. invite_patient: no behavior change, comment only. Replaced so the stored
--    body matches the schema of record exactly.
-- ---------------------------------------------------------------------------
-- Invite a PATIENT by email. Same token machinery as invite_staff and the same
-- guarantee: the token says which invite, the verified email is the gate. Split
-- from invite_staff rather than folded into it so a patient form can never be
-- coaxed into minting a therapist or manager invite by passing a role.
create or replace function public.invite_patient(
    p_email text, p_first_name text, p_last_name text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite patients'; end if;
  -- ⚠️ BOTH NAMES ARE REQUIRED FOR A PATIENT, AND THE RULE LIVES HERE RATHER
  -- THAN ONLY IN THE FORM. The roster is how a clinic tells one patient from
  -- another, and David's clinics routinely have several patients sharing a
  -- first name and a therapist. A form check alone would be a suggestion; this
  -- is the guarantee. (Staff are held to the same rule since 2026-09-15; the
  -- identical pair of checks is in invite_staff.)
  if nullif(btrim(p_first_name), '') is null then
    raise exception 'A first name is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_last_name), '') is null then
    raise exception 'A last name is required' using errcode = 'P0001';
  end if;
  insert into public.staff_invites (clinic_id, email, first_name, last_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), btrim(p_first_name),
          btrim(p_last_name), 'patient', public.current_user_id())
  on conflict (clinic_id, email) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        role = 'patient',
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

alter function public.invite_patient(text, text, text) owner to glowpt_auth;
revoke execute on function public.invite_patient(text, text, text) from public;
grant  execute on function public.invite_patient(text, text, text) to glowpt_app;

-- ---------------------------------------------------------------------------
-- GUARDS. Ownership and grants, then the behavior itself: a guard that only
-- checks a function exists would have passed before this patch too.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- Exactly one of each signature, owned by glowpt_auth, or SECURITY DEFINER
  -- would run as whoever created it.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('invite_staff','join_clinic','invite_patient')
     and pg_get_userbyid(p.proowner) = 'glowpt_auth';
  if n <> 3 then raise exception 'GUARD: expected 3 glowpt_auth-owned functions, found %', n; end if;

  -- PUBLIC must not hold EXECUTE on either.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('invite_staff','join_clinic','invite_patient')
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then raise exception 'GUARD: a patched function is executable by PUBLIC'; end if;

  -- The app role must hold both, or the routes 500 on every call.
  if not has_function_privilege('glowpt_app',
        'public.invite_staff(text,text,text,text)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute invite_staff';
  end if;
  if not has_function_privilege('glowpt_app',
        'public.join_clinic(text,text,text,text)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute join_clinic';
  end if;
  if not has_function_privilege('glowpt_app',
        'public.invite_patient(text,text,text)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute invite_patient';
  end if;

  -- The behavior, read out of the source rather than by calling it: calling it
  -- here would mint a real invite in a real clinic.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('invite_staff','join_clinic','invite_patient')
     and pg_get_functiondef(p.oid) like '%A last name is required%'
     and pg_get_functiondef(p.oid) like '%A first name is required%';
  if n <> 3 then
    raise exception 'GUARD: a patched function is missing its name checks (found %)', n;
  end if;

  raise notice 'PATCH OK: invite_staff, join_clinic and invite_patient all require both names.';
end $$;

commit;
