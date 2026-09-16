-- ============================================================================
-- 2026-09-16 (2) — the clinic list reports when records were last exported.
--
-- WHY (David, having archived and exported Top of the Hill PT before deleting
-- it): "add the exported date line". The delete confirmation now says either
-- "Records exported Sep 16, 2026." or "No export has been taken.", so the last
-- irreversible step states the one fact that decides whether you should take it.
--
-- ⛔ IT DOES NOT BLOCK THE DELETION, deliberately. Forcing an export would put a
-- file of patient notes on someone's laptop for every throwaway clinic, which
-- is a worse habit than the one it prevents. David: "it looks like delete
-- doesn't require you to export, but i didn't test that. Should it, maybe not."
--
-- ⚠️ NO NEW COLUMN. Every export already writes an access_log row, so the last
-- one is a fact we hold; reading it is what makes it impossible for a second
-- copy to drift from the audit trail.
--
-- admin_list_clinics is DROPPED and recreated: its return type gains a column,
-- which a create-or-replace cannot do. The API reads rows BY NAME, so the
-- version running while this lands is unaffected and needs no redeploy.
--
-- SAFE TO RUN: one function, no data touched, re-runnable.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

drop function if exists public.admin_list_clinics();

create or replace function public.admin_list_clinics()
  returns table (
    id              uuid,
    name            text,
    slug            text,
    created_at      timestamptz,
    activated_at    timestamptz,
    archived_at     timestamptz,
    baa_signed_at   timestamptz,
    baa_version     text,
    -- ⚠️ READ FROM access_log, not a column. Every export writes a row there
    -- (see admin_export_clinic), so the last one is a fact we already hold and
    -- the delete confirmation can say whether records were ever taken out.
    last_exported_at timestamptz,
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
    select c.id, c.name, c.slug, c.created_at, c.activated_at, c.archived_at,
           c.baa_signed_at, c.baa_version,
           (select max(a.created_at) from public.access_log a
             where a.clinic_id = c.id and a.action = 'clinic_exported'),
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

alter function public.admin_list_clinics() owner to glowpt_auth;
revoke execute on function public.admin_list_clinics() from public;
grant  execute on function public.admin_list_clinics() to glowpt_app;

do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_list_clinics'
     and pg_get_userbyid(p.proowner) = 'glowpt_auth'
     and not has_function_privilege('public', p.oid, 'execute')
     and pg_get_functiondef(p.oid) like '%clinic_exported%';
  if n <> 1 then raise exception 'GUARD: admin_list_clinics is not installed as expected'; end if;
  if not has_function_privilege('glowpt_app', 'public.admin_list_clinics()', 'execute') then
    raise exception 'GUARD: glowpt_app cannot execute admin_list_clinics';
  end if;
  raise notice 'PATCH OK: the clinic list now reports last_exported_at.';
end $$;

commit;
