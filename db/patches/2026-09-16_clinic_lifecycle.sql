-- ============================================================================
-- 2026-09-16 — the clinic lifecycle: archive, export, delete.
--
-- WHY (David): "I need a way to archive and maybe delete joined clinics from my
-- admin dashboard, the same way maybe we have for patients now. Then I can also
-- delete out or archive my test clinics."
--
-- It is deliberately the SAME shape as the patient roster's Archive and Remove,
-- one level up, so there is one pattern to know rather than two:
--   Archive  reversible, files it away, and switches it off.
--   Export   hand the records back before destroying them (the BAA promises it).
--   Delete   only from archived, takes the clinic's people with it, permanent.
--
-- WHAT IT ADDS:
--   clinics.archived_at        a third state, independent of activated_at
--   public.clinic_deletions    the ledger of what was deleted, and by whom
--   admin_archive_clinic       archive / restore
--   admin_clinic_purge_target  the guards + the logins a delete would remove
--   admin_export_clinic        the whole clinic as one JSON document
--   admin_delete_clinic        the deletion itself
--
-- ⛔ THE GUARD THAT MATTERS MOST: a PLATFORM ADMIN is never deleted. David
-- manages Riverside PT with the same address he administers GlowPT with, so a
-- delete that took every member would delete his own login and lock him out of
-- /admin. Admins are detached from the clinic instead. Tests T71 and T73 exist
-- for exactly this and are the ones to watch.
--
-- ⚠️ admin_list_clinics IS DROPPED AND RECREATED, not replaced. It gains a
-- column (archived_at), and a changed RETURN TYPE cannot be a create-or-replace.
-- The API in front of it reads rows BY NAME, so the extra column is harmless to
-- the version running while this lands.
--
-- DEPLOY ORDER: this patch, THEN the API, THEN the frontend. Each layer only
-- uses what the one under it already has.
--
-- SAFE TO RUN: adds a column and a table, replaces functions, deletes nothing,
-- and is re-runnable. Nothing it adds does anything until someone presses a
-- button that does not exist yet.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- 1. The third state, and the ledger.
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists archived_at timestamptz;

create table if not exists public.clinic_deletions (
  id            uuid primary key default gen_random_uuid(),
  clinic_name   text not null,
  clinic_slug   text not null,
  patient_count integer not null,
  staff_count   integer not null,
  deleted_by    uuid references public.users(id) on delete set null,
  deleted_at    timestamptz not null default now()
);
alter table public.clinic_deletions owner to glowpt_owner;
alter table public.clinic_deletions enable row level security;
alter table public.clinic_deletions force  row level security;
-- No policies and no grant to glowpt_app, exactly like platform_admins: the
-- only way in is a SECURITY DEFINER function.
grant select, insert on public.clinic_deletions to glowpt_auth;

-- Deleting a clinic row is new, and is the only delete this grant enables. Its
-- people are removed one users row at a time, which the existing grant covers.
grant delete on public.clinics to glowpt_auth;

-- ---------------------------------------------------------------------------
-- 2. admin_list_clinics gains archived_at. DROPPED first: the return type
--    changes, so a replace is not possible.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. The lifecycle itself.
-- ---------------------------------------------------------------------------
-- Archive or restore. Archiving ALSO switches the clinic off: a clinic filed
-- away must not still be accepting check-ins. Restoring deliberately does NOT
-- switch it back on -- that gate needs the BAA and a separate decision.
create or replace function public.admin_archive_clinic(p_clinic uuid, p_archived boolean)
  returns timestamptz
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_now timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if p_archived then
    update public.clinics
       set archived_at = coalesce(archived_at, now()),
           activated_at = null,
           activated_by = public.current_user_id()
     where id = p_clinic
    returning archived_at into v_now;
  else
    update public.clinics set archived_at = null where id = p_clinic
    returning archived_at into v_now;
  end if;
  if not found then raise exception 'Clinic not found'; end if;

  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), p_clinic,
          case when p_archived then 'clinic_archived' else 'clinic_restored' end);

  return v_now;
end $$;

-- What a deletion would remove, and the guards, WITHOUT removing anything. The
-- twin of purge_target: the API calls this first to learn which logins to
-- delete from Cognito, then calls admin_delete_clinic, which re-applies every
-- guard inside its own transaction because state can change in between.
--
-- ⛔ A PLATFORM ADMIN IS NEVER RETURNED, AND THAT IS LOAD-BEARING. David manages
-- Riverside PT with the same address he administers GlowPT with, so a delete
-- that took every member would delete his own login and lock him out of /admin.
-- Admins are detached from the clinic instead (see admin_delete_clinic).
create or replace function public.admin_clinic_purge_target(p_clinic uuid)
  returns table (email citext, patient_count integer, staff_count integer)
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_archived timestamptz; v_exists boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select true, c.archived_at from public.clinics c where c.id = p_clinic
    into v_exists, v_archived;
  if v_exists is not true then raise exception 'Clinic not found'; end if;

  -- ⛔ ARCHIVE FIRST, exactly as a patient must be archived before removal.
  -- Permanent deletion is never one click from a live clinic.
  if v_archived is null then
    raise exception 'Archive this clinic first. Deleting is permanent.' using errcode = 'P0001';
  end if;

  return query
    select u.email,
           (select count(*)::integer from public.profiles p
             where p.clinic_id = p_clinic and p.role = 'patient'),
           (select count(*)::integer from public.profiles p
             where p.clinic_id = p_clinic and p.role in ('manager','therapist'))
      from public.profiles pr
      join public.users u on u.id = pr.id
     where pr.clinic_id = p_clinic
       and not exists (select 1 from public.platform_admins pa where pa.user_id = pr.id);
end $$;

-- Everything this clinic holds, as one JSON document, so a clinic's records can
-- be handed back before they are destroyed. The BAA promises exactly this:
-- "You can export your clinic's data. We return or destroy the protected health
-- information we hold."
--
-- ⚠️ THE RESULT IS FULL PHI -- names, moods, notes, reflections. It is the one
-- place in this schema that deliberately hands a whole clinic's records to a
-- caller, which is why it is platform-admin only and why it writes an audit row
-- saying it happened. The screen that calls it says so too.
create or replace function public.admin_export_clinic(p_clinic uuid)
  returns jsonb
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_doc jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic) then
    raise exception 'Clinic not found';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'clinic', (select jsonb_build_object(
                 'name', c.name, 'slug', c.slug, 'created_at', c.created_at,
                 'activated_at', c.activated_at, 'archived_at', c.archived_at,
                 'baa_signed_at', c.baa_signed_at, 'baa_version', c.baa_version)
                 from public.clinics c where c.id = p_clinic),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
                 'first_name', p.first_name, 'last_name', p.last_name,
                 'email', u.email, 'role', p.role, 'joined_at', p.created_at)
                 order by p.first_name)
                 from public.profiles p join public.users u on u.id = p.id
                where p.clinic_id = p_clinic and p.role in ('manager','therapist')), '[]'::jsonb),
    'patients', coalesce((select jsonb_agg(jsonb_build_object(
                 'first_name', p.first_name, 'last_name', p.last_name,
                 'email', u.email, 'joined_at', p.created_at,
                 'archived_at', p.discharged_at,
                 'therapist', t.full_name)
                 order by p.first_name)
                 from public.profiles p
                 join public.users u on u.id = p.id
                 left join public.profiles t on t.id = p.therapist_id
                where p.clinic_id = p_clinic and p.role = 'patient'), '[]'::jsonb),
    -- The records themselves. local_date goes out as text for the same reason
    -- every other read does it: a date becomes a full ISO timestamp otherwise.
    'checkins', coalesce((select jsonb_agg(jsonb_build_object(
                 'patient', p.full_name, 'email', u.email,
                 'date', to_char(k.local_date, 'YYYY-MM-DD'),
                 'feeling', k.feeling, 'feeling_word', k.feeling_word,
                 'movements', k.movements, 'other_movement', k.other_movement,
                 'note', k.note, 'reflection', k.ai_response,
                 'saved_at', k.created_at)
                 order by k.local_date, p.full_name)
                 from public.checkins k
                 join public.profiles p on p.id = k.user_id
                 join public.users u on u.id = k.user_id
                where k.clinic_id = p_clinic), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object(
                 'name', p.full_name, 'email', u.email, 'type', co.type,
                 'version', co.version, 'consented_at', co.consented_at)
                 order by co.consented_at)
                 from public.consents co
                 join public.profiles p on p.id = co.user_id
                 join public.users u on u.id = co.user_id
                where co.clinic_id = p_clinic), '[]'::jsonb)
  ) into v_doc;

  insert into public.access_log (actor_id, clinic_id, action)
  values (public.current_user_id(), p_clinic, 'clinic_exported');

  return v_doc;
end $$;

-- Permanently delete an ARCHIVED clinic and everyone in it.
--
-- ⚠️ THIS IS THE LARGEST DESTRUCTIVE ACT IN THE APP. Deleting the clinic row
-- cascades its check-ins and its invites; each member's users row is deleted
-- individually, which cascades their profile, their consents and their own
-- check-ins. Their Cognito login is deleted by the API before this runs, the
-- same order purge_patient uses: the login first, then the rows, so a failure
-- half way leaves a state a retry can finish.
--
-- ⛔ PLATFORM ADMINS ARE DETACHED, NOT DELETED. See admin_clinic_purge_target.
create or replace function public.admin_delete_clinic(p_clinic uuid)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_name text; v_slug text; v_patients integer; v_staff integer;
begin
  -- Guards re-applied HERE, inside this transaction, not trusted from the
  -- caller's earlier read.
  select t.patient_count, t.staff_count into v_patients, v_staff
    from public.admin_clinic_purge_target(p_clinic) t limit 1;
  select c.name, c.slug into v_name, v_slug from public.clinics c where c.id = p_clinic;
  if v_name is null then raise exception 'Clinic not found'; end if;
  -- A clinic with no members at all returns no rows above, so the counts come
  -- back null. They are counts, not a reason to refuse.
  v_patients := coalesce(v_patients, 0);
  v_staff := coalesce(v_staff, 0);

  -- The people. Admins keep their account and simply lose the clinic.
  update public.profiles p
     set clinic_id = null, therapist_id = null
   where p.clinic_id = p_clinic
     and exists (select 1 from public.platform_admins pa where pa.user_id = p.id);

  delete from public.users u
   where u.id in (select p.id from public.profiles p where p.clinic_id = p_clinic)
     and not exists (select 1 from public.platform_admins pa where pa.user_id = u.id);

  -- The record of what happened, written BEFORE the clinic row goes: nothing
  -- here points at the clinic, so nothing is nulled out when it does.
  insert into public.clinic_deletions
    (clinic_name, clinic_slug, patient_count, staff_count, deleted_by)
  values (v_name, v_slug, v_patients, v_staff, public.current_user_id());

  -- And the clinic. Cascades staff_invites and anything left in checkins.
  delete from public.clinics where id = p_clinic;
end $$;

alter function public.admin_archive_clinic(uuid, boolean)     owner to glowpt_auth;
alter function public.admin_clinic_purge_target(uuid)         owner to glowpt_auth;
alter function public.admin_export_clinic(uuid)               owner to glowpt_auth;
alter function public.admin_delete_clinic(uuid)               owner to glowpt_auth;

revoke execute on function public.admin_archive_clinic(uuid, boolean)     from public;
revoke execute on function public.admin_clinic_purge_target(uuid)         from public;
revoke execute on function public.admin_export_clinic(uuid)               from public;
revoke execute on function public.admin_delete_clinic(uuid)               from public;

grant  execute on function public.admin_archive_clinic(uuid, boolean)     to glowpt_app;
grant  execute on function public.admin_clinic_purge_target(uuid)         to glowpt_app;
grant  execute on function public.admin_export_clinic(uuid)               to glowpt_app;
grant  execute on function public.admin_delete_clinic(uuid)               to glowpt_app;

-- ---------------------------------------------------------------------------
-- GUARDS.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- The column and the ledger.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'clinics' and column_name = 'archived_at';
  if n <> 1 then raise exception 'GUARD: clinics.archived_at is missing'; end if;

  select count(*) into n from pg_tables where schemaname = 'public' and tablename = 'clinic_deletions';
  if n <> 1 then raise exception 'GUARD: clinic_deletions is missing'; end if;

  -- ⛔ The ledger must be unreachable by the app role, like platform_admins.
  select count(*) into n from information_schema.role_table_grants
   where table_name = 'clinic_deletions' and grantee = 'glowpt_app';
  if n <> 0 then raise exception 'GUARD: glowpt_app was granted % on clinic_deletions', n; end if;

  -- Five functions, all owned by glowpt_auth, none executable by PUBLIC.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('admin_list_clinics','admin_archive_clinic',
                       'admin_clinic_purge_target','admin_export_clinic','admin_delete_clinic')
     and pg_get_userbyid(p.proowner) = 'glowpt_auth';
  if n <> 5 then raise exception 'GUARD: expected 5 glowpt_auth-owned functions, found %', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('admin_list_clinics','admin_archive_clinic',
                       'admin_clinic_purge_target','admin_export_clinic','admin_delete_clinic')
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then raise exception 'GUARD: a patched function is executable by PUBLIC'; end if;

  -- ⛔ THE ADMIN GUARD, read out of the stored source. If this ever goes
  -- missing, deleting Riverside PT deletes David's own login.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('admin_clinic_purge_target','admin_delete_clinic')
     and pg_get_functiondef(p.oid) like '%platform_admins%';
  if n <> 2 then raise exception 'GUARD: the platform-admin exclusion is missing'; end if;

  -- And that a delete still refuses a clinic that is not archived.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_clinic_purge_target'
     and pg_get_functiondef(p.oid) like '%Archive this clinic first%';
  if n <> 1 then raise exception 'GUARD: the archive-first check is missing'; end if;

  raise notice 'PATCH OK: archive, export and delete are installed. Admins are excluded from deletion.';
end $$;

commit;
