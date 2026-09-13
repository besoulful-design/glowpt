-- ============================================================================
-- 2026-09-13 — rename_patient: let a manager correct a patient's name.
--
-- WHY: three patients (Natalie, Charlie, Timmy) predate two-field invites and
-- have a first name only, so the roster still cannot tell them apart from
-- anyone sharing that first name -- and nothing in the app could fix it. A
-- typo at invite time was equally unfixable.
--
-- WHY AN RPC AND NOT AN UPDATE: glowpt_app holds update (first_name, last_name)
-- on profiles, but profiles_update_self scopes that to the caller's OWN row, so
-- a manager physically cannot write another person's name through the table.
-- That default is right and stays. This is the one narrow, audited exception.
--
-- ⛔ PATIENTS ONLY, matching assign_therapist / discharge / purge. A manager
-- cannot rename a therapist or another manager.
--
-- SAFE TO RUN: creates one function, changes no data, drops nothing. It adds a
-- capability that did not exist, so nothing currently deployed can call it and
-- there is no ordering constraint against the API deploy.
--
-- ⚠️ A PATCH LEAVES A NEW FUNCTION EXECUTABLE BY PUBLIC; A FRESH BUILD DOES
-- NOT. db/schema.sql strips the implicit grant with a blanket revoke near its
-- foot, and a patch has no such sweep, so the revoke below is required and the
-- guard asserts it took. (Caught on 2026-09-05 by diffing a rehearsed patch
-- against a fresh build.)
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- rename_patient: a manager corrects a patient's name.
--
-- ⚠️ WHY THIS IS AN RPC AND NOT AN UPDATE. glowpt_app holds
-- update (first_name, last_name) on profiles, but profiles_update_self scopes
-- that to the caller's OWN row, so a manager physically cannot write another
-- person's name through the table. That is the right default and stays; this
-- function is the one narrow, audited exception, and like every other manager
-- power it re-derives the caller's clinic and role inside Postgres.
--
-- ⛔ PATIENTS ONLY, exactly like assign_therapist / discharge / purge. A manager
-- cannot rename a therapist or another manager: the role test below is what
-- stops it, and it is deliberate rather than an oversight. Staff names come
-- from the invite and from the person themselves.
--
-- A last name is REQUIRED here, matching invite_patient. The roster is how a
-- clinic tells two patients with the same first name apart, and an edit screen
-- that could empty the surname would be a way to undo that one row at a time.
-- (The three patients who predate two-field invites have no surname; this is
-- the tool that gives them one.)
create or replace function public.rename_patient(
    p_patient uuid, p_first_name text, p_last_name text)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles
    where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can rename patients'; end if;
  -- Same clinic AND role 'patient'. A manager of clinic A renaming a patient of
  -- clinic B, or renaming a colleague, both fail here.
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic'; end if;
  if nullif(btrim(p_first_name), '') is null then
    raise exception 'A first name is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_last_name), '') is null then
    raise exception 'A last name is required' using errcode = 'P0001';
  end if;
  update public.profiles
     set first_name = btrim(p_first_name), last_name = btrim(p_last_name)
   where id = p_patient;
  -- Audited. Changing the name a clinic identifies someone by is a records
  -- change, so it leaves a trail like every other staff action on a patient.
  -- ⚠️ The names themselves are NOT written here: access_log is a log of WHO
  -- did WHAT to WHOM, and putting a patient's name in it would spread the
  -- identifier rather than record the act.
  insert into public.access_log (actor_id, action, clinic_id, target_user_id)
  values (public.current_user_id(), 'rename_patient', v_clinic, p_patient);
end $$;

alter function public.rename_patient(uuid, text, text) owner to glowpt_auth;
revoke execute on function public.rename_patient(uuid, text, text) from public;
grant  execute on function public.rename_patient(uuid, text, text) to glowpt_app;

-- ---------------------------------------------------------------------------
-- GUARDS.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'rename_patient';
  if n <> 1 then raise exception 'GUARD: expected 1 rename_patient, found %', n; end if;

  -- Owned by glowpt_auth, or SECURITY DEFINER would run as whoever created it.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'rename_patient'
     and pg_get_userbyid(p.proowner) = 'glowpt_auth';
  if n <> 1 then raise exception 'GUARD: rename_patient is not owned by glowpt_auth'; end if;

  -- PUBLIC must not hold EXECUTE. A patch does not get schema.sql's sweep.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'rename_patient'
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then raise exception 'GUARD: rename_patient is executable by PUBLIC'; end if;

  -- The app role must hold it, or the route 500s on every call.
  if not has_function_privilege('glowpt_app',
        'public.rename_patient(uuid,text,text)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute rename_patient';
  end if;

  raise notice 'PATCH OK: rename_patient installed, owned by glowpt_auth, PUBLIC revoked.';
end $$;

commit;
