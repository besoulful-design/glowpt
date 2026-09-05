-- 2026-09-05 — cancelling a pending invite, and removing a patient enrolled by mistake.
--
-- WHY THESE TWO AND NOT A GENERAL DELETE (David's call, after the options were
-- laid out): removing a MISTAKE is not the same as deleting a patient's records.
-- A test account, a typo'd email, someone enrolled who was never your patient —
-- that has no history and purging it is clean. Deleting a real patient's
-- check-ins is a records-retention decision the clinic owns, and discharge (soft
-- delete, reversible, data kept) is the honest answer there. So purge_patient
-- REFUSES anyone who has ever checked in.
--
-- ⚠️ revoke_invite closes a real hole, not just an inconvenience. Until now a
-- pending invite could not be cancelled at all: an invite sent to the wrong
-- address stayed live for its full 14 days, and whoever holds that address could
-- accept it and land inside the clinic. Re-inviting the right person mints a
-- fresh token for THEM; it does nothing about a wrong address.
begin;

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

-- Ownership matches every other definer function in this schema. ⚠️ It is NOT
-- cosmetic: a SECURITY DEFINER function runs as its OWNER, so leaving these
-- owned by the admin role that applies the patch would run a delete as a
-- superuser. Locally that also masks the missing grant below, because the test
-- database's owner is a superuser.
alter function public.revoke_invite(text)                     owner to glowpt_auth;
alter function public.purge_patient(uuid)                     owner to glowpt_auth;

-- ⚠️ THE ONLY DELETE RIGHTS IN THE APP, and deliberately just these two tables.
-- Everything else glowpt_auth can do is select/insert/update, because until
-- 2026-09-05 nothing in GlowPT deleted anything. purge_patient needs them to
-- remove a patient enrolled by mistake; revoke_invite needs the invite one to
-- cancel a pending invite. Postgres performs ON DELETE CASCADE with the table
-- owner's rights, not the caller's, so removing a users row still clears
-- profiles/consents/checkins without granting delete on any of those.
grant delete on public.users         to glowpt_auth;
grant delete on public.staff_invites to glowpt_auth;

-- A patch creates functions with an implicit EXECUTE grant to PUBLIC; a fresh
-- build does not, because db/schema.sql sweeps it at the foot. Revoke BEFORE
-- granting or these land executable by every role (2026-09-05 lesson).
revoke execute on function public.revoke_invite(text)  from public;
revoke execute on function public.purge_patient(uuid)  from public;
grant  execute on function public.revoke_invite(text)  to glowpt_app;
grant  execute on function public.purge_patient(uuid)  to glowpt_app;

do $$
begin
  if has_function_privilege('public', 'public.revoke_invite(text)', 'execute')
  or has_function_privilege('public', 'public.purge_patient(uuid)', 'execute') then
    raise exception 'GUARD FAILED: PUBLIC can execute one of the new functions';
  end if;
  if not has_function_privilege('glowpt_app', 'public.purge_patient(uuid)', 'execute') then
    raise exception 'GUARD FAILED: glowpt_app cannot execute purge_patient';
  end if;
  raise notice 'GUARDS PASSED';
end $$;

commit;
