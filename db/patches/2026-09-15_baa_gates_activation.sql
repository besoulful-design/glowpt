-- ============================================================================
-- 2026-09-15 (2) — the BAA record is the key to the activation switch.
--
-- WHY (David, reading his own admin screen): "I shouldn't otherwise be able to
-- switch on a clinic if the 'record baa signed' isn't ticked, right. Because
-- I've been using my switched on clinics without ever clicking that."
-- He is right. Switching a clinic on is the exact moment real patient health
-- information becomes allowed to flow into it, and a signed BAA is what makes
-- that lawful. The two columns were deliberately independent; independent was
-- too weak.
--
-- WHAT IT CHANGES:
--   admin_set_clinic_active -- switching ON now requires baa_signed_at. Switching
--                              OFF is untouched and must stay that way: a clinic
--                              has to be closeable in a hurry.
--   admin_clear_baa (NEW)   -- a mistaken BAA date can be corrected. One tap used
--                              to write a dated legal record with no way back,
--                              and David wrote a false one on a test clinic
--                              before anyone noticed. ⛔ REFUSED while the clinic
--                              is ON, or clearing one underneath a running clinic
--                              would reach the state the gate exists to prevent.
--                              The correction is audited like the record itself.
--
-- ⛔ CLINICS ALREADY ON STAY ON. The check happens when the switch is thrown,
-- not continuously, so Riverside PT, RidgePT and Top of the Hill PT keep running
-- with no BAA recorded. If one is ever switched off, its BAA must be recorded
-- before it can come back on. That is the rule working, not a fault.
--
-- SAFE TO RUN: changes no data, drops nothing, re-runnable. It only ever REFUSES
-- a call that used to succeed, so the frontend that stops offering that call
-- deploys FIRST -- otherwise the Switch On button would hand back a raw database
-- error instead of explaining itself.
--
-- ⚠️ BOTH BODIES ARE LIFTED VERBATIM FROM db/schema.sql, not retyped.
-- ⚠️ A PATCH LEAVES A NEW FUNCTION EXECUTABLE BY PUBLIC; A FRESH BUILD DOES NOT.
-- admin_clear_baa is genuinely new here, so its revoke is load-bearing, not
-- belt and braces. The guards assert it took.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- 1. admin_set_clinic_active: switching ON requires the BAA record.
-- ---------------------------------------------------------------------------
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

  -- ⚠️ THE BAA IS THE KEY TO THIS SWITCH (David, 2026-09-15). Switching a clinic
  -- on is the exact moment real patient health information becomes allowed to
  -- flow into it, and a signed BAA is what makes that lawful, so the record has
  -- to exist BEFORE the gate opens rather than being filled in afterward or
  -- never. David spotted it himself: his own clinics had been running for days
  -- with no BAA recorded and nothing had objected.
  --
  -- Only switching ON is gated. Switching OFF must always work, or a clinic
  -- could not be closed in a hurry. A clinic activated before this rule keeps
  -- running: the check happens when the switch is thrown, not continuously.
  if p_active then
    if not exists (select 1 from public.clinics
                    where id = p_clinic and baa_signed_at is not null) then
      raise exception 'Record the signed BAA before switching this clinic on'
        using errcode = 'P0001';
    end if;
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

alter function public.admin_set_clinic_active(uuid, boolean) owner to glowpt_auth;
revoke execute on function public.admin_set_clinic_active(uuid, boolean) from public;
grant  execute on function public.admin_set_clinic_active(uuid, boolean) to glowpt_app;

-- ---------------------------------------------------------------------------
-- 2. admin_clear_baa: NEW. Correct a BAA date entered by mistake.
-- ---------------------------------------------------------------------------
-- Clear a BAA record entered by mistake. One tap used to write a dated legal
-- record with no way back, and a date saying a BAA was signed on a day it was
-- not is the wrong kind of wrong to leave in a database (David recorded one on
-- a test clinic 2026-09-15 and there was no undo).
--
-- ⛔ REFUSED WHILE THE CLINIC IS ON, and that is the whole design. Since
-- admin_set_clinic_active now requires a BAA to open the gate, clearing one
-- underneath a running clinic would leave exactly the state the gate exists to
-- prevent. Switch the clinic off first: one deliberate act, audited like the
-- rest of this screen.
create or replace function public.admin_clear_baa(p_clinic uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if exists (select 1 from public.clinics
              where id = p_clinic and activated_at is not null) then
    raise exception 'Switch the clinic off before clearing its BAA record'
      using errcode = 'P0001';
  end if;

  update public.clinics set baa_signed_at = null, baa_version = null
   where id = p_clinic;
  if not found then raise exception 'Clinic not found'; end if;

  -- Audited exactly like recording it. A correction is an act, not an erasure.
  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), p_clinic, 'baa_cleared');
end $$;

alter function public.admin_clear_baa(uuid) owner to glowpt_auth;
revoke execute on function public.admin_clear_baa(uuid) from public;
grant  execute on function public.admin_clear_baa(uuid) to glowpt_app;

-- ---------------------------------------------------------------------------
-- GUARDS. Ownership and grants, then the behavior: a guard that only checks a
-- function exists would have passed before this patch too.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('admin_set_clinic_active','admin_clear_baa')
     and pg_get_userbyid(p.proowner) = 'glowpt_auth';
  if n <> 2 then raise exception 'GUARD: expected 2 glowpt_auth-owned functions, found %', n; end if;

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('admin_set_clinic_active','admin_clear_baa')
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then raise exception 'GUARD: a patched function is executable by PUBLIC'; end if;

  if not has_function_privilege('glowpt_app',
        'public.admin_set_clinic_active(uuid,boolean)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute admin_set_clinic_active';
  end if;
  if not has_function_privilege('glowpt_app', 'public.admin_clear_baa(uuid)', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute admin_clear_baa';
  end if;

  -- The gate itself, read out of the stored source.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_set_clinic_active'
     and pg_get_functiondef(p.oid) like '%Record the signed BAA%';
  if n <> 1 then raise exception 'GUARD: admin_set_clinic_active is missing the BAA check'; end if;

  -- And that the correction refuses to run under a live clinic.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_clear_baa'
     and pg_get_functiondef(p.oid) like '%Switch the clinic off%'
     and pg_get_functiondef(p.oid) like '%baa_cleared%';
  if n <> 1 then raise exception 'GUARD: admin_clear_baa is missing its guard or its audit row'; end if;

  raise notice 'PATCH OK: the BAA record now gates activation, and a mistaken one can be corrected.';
end $$;

commit;
