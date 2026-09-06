-- 2026-09-06 — a manager may remove a patient who has check-ins.
--
-- WHY. Removal previously refused anyone who had ever checked in, so it only
-- cleared up mistakes. David's call: the manager IS the covered entity, and
-- whether a patient's record is destroyed is their decision, not ours to block.
-- GlowPT is the business associate and acts on their instruction. HIPAA gives
-- patients a right to access and amend, not a right to erasure, and state law
-- often REQUIRES retention -- so this is the clinic's call in both directions.
--
-- The deliberateness moves to where it belongs: the manager types the patient's
-- name on screen, the patient must already be archived, and the removal is
-- recorded in access_log.
--
-- Adds purge_target so the API can learn the address under the same guards
-- BEFORE deleting anything, which is what lets it delete the Cognito login
-- first and keeps the whole operation retryable.
--
-- Idempotent. Deletes no data of its own.

\set ON_ERROR_STOP on
begin;

-- ⚠️ A PATCH LEAVES A NEW FUNCTION EXECUTABLE BY PUBLIC; A FRESH BUILD DOES NOT.
-- db/schema.sql strips that with a blanket revoke near its foot, which a patch
-- has no equivalent of. Revoke BEFORE granting, or glowpt_weekly and
-- glowpt_postconfirm silently gain rights they must never have. (Learned
-- 2026-09-05, caught only by diffing a rehearsed patch against a fresh build.)

create or replace function public.purge_target(p_patient uuid)
  returns table (email citext, clinic_id uuid)
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_discharged timestamptz; v_exists boolean;
begin
  select p.clinic_id from public.profiles p
    where p.id = public.current_user_id() and p.role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can remove a patient'; end if;
  if p_patient = public.current_user_id() then raise exception 'You cannot remove yourself'; end if;

  select true, p.discharged_at from public.profiles p
   where p.id = p_patient and p.clinic_id = v_clinic and p.role = 'patient'
   into v_exists, v_discharged;
  if v_exists is not true then raise exception 'Patient not in your clinic'; end if;

  -- ⛔ ARCHIVE FIRST. Permanent removal is never one click from the live roster,
  -- whatever a screen chooses to render. (The UI calls this state "Archived";
  -- the column is still `discharged_at` -- see the note on discharge_patient.)
  if v_discharged is null then
    raise exception 'Archive this patient first. Removing is permanent.';
  end if;

  return query
    select u.email, v_clinic from public.users u where u.id = p_patient;
end $$;

create or replace function public.purge_patient(p_patient uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email citext; v_clinic uuid;
begin
  -- Guards live in purge_target and are re-applied HERE, inside this
  -- transaction, because state can change between the API's two calls.
  select t.email, t.clinic_id into v_email, v_clinic from public.purge_target(p_patient) t;

  -- Cascades profiles, checkins, consents and their access_log rows as actor.
  -- Their pending/consumed invite row is keyed by email and is removed too, so
  -- the address is clean to re-invite.
  delete from public.staff_invites
   where clinic_id = v_clinic and lower(email) = lower(v_email);
  delete from public.users where id = p_patient;

  -- ⚠️ RECORDED, BUT WITHOUT NAMING THEM, AND THAT IS THE POINT. A permanent
  -- deletion leaving no trace of who did it or when is the wrong shape for a
  -- HIPAA product. But storing target_user_id here would keep a pointer to the
  -- person we just deleted, and combined with the 35-day RDS backups that
  -- re-identifies them -- which defeats the deletion the manager just asked for.
  -- So: who did it, which clinic, when. Not who it was.
  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), v_clinic, 'patient_removed');
end $$;

alter function public.purge_target(uuid)  owner to glowpt_auth;
alter function public.purge_patient(uuid) owner to glowpt_auth;

revoke execute on function public.purge_target(uuid)  from public;
revoke execute on function public.purge_patient(uuid) from public;
grant  execute on function public.purge_target(uuid)  to glowpt_app;
grant  execute on function public.purge_patient(uuid) to glowpt_app;

-- Guards: prove the permission surface is what we intend, before committing.
do $$
declare owner_ok boolean; public_ok boolean; app_ok boolean;
begin
  select bool_and(pg_get_userbyid(proowner) = 'glowpt_auth') into owner_ok
    from pg_proc where proname in ('purge_target','purge_patient')
     and pronamespace = 'public'::regnamespace;
  if not owner_ok then raise exception 'ABORTING: purge functions are not owned by glowpt_auth.'; end if;

  select bool_or(has_function_privilege('public', p.oid, 'execute')) into public_ok
    from pg_proc p where p.proname in ('purge_target','purge_patient')
     and p.pronamespace = 'public'::regnamespace;
  if public_ok then raise exception 'ABORTING: PUBLIC can execute a purge function.'; end if;

  select bool_and(has_function_privilege('glowpt_app', p.oid, 'execute')) into app_ok
    from pg_proc p where p.proname in ('purge_target','purge_patient')
     and p.pronamespace = 'public'::regnamespace;
  if not app_ok then raise exception 'ABORTING: glowpt_app cannot execute the purge functions.'; end if;

  raise notice 'GUARDS PASSED: purge_target + purge_patient owned by glowpt_auth, PUBLIC denied, glowpt_app granted.';
end $$;

commit;
