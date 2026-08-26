-- 2026-08-26 — Per-clinic activation gate + platform-admin switch.
--
-- WHY: until now nothing in the system stopped a self-serve clinic from
-- enrolling real patients. The dashboard banner asks them not to; that is a
-- sign on the door, not a lock. This patch makes it a lock, and gives David a
-- switch he alone can flip.
--
-- TWO SEPARATE FACTS, DELIBERATELY TWO COLUMNS:
--   baa_signed_at  = when the clinic signed the BAA        (the legal record)
--   activated_at   = when David let them start enrolling   (the gate)
-- They are usually flipped together, but not always: a demo clinic is active
-- with no BAA, and a clinic could sign before David switches them on. Folding
-- them into one column would force a lie in whichever direction differs.
--
-- SAFE TO RE-RUN. Nothing is deleted. Existing clinics are activated below so
-- the Riverside demo and the Monday heartbeat keep working.

begin;

-- ---------------------------------------------------------------- 1. columns
alter table public.clinics
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references public.users(id);

comment on column public.clinics.activated_at is
  'Null = cannot enrol patients or accept check-ins. Set only by admin_set_clinic_active().';

-- ------------------------------------------------- 2. is-this-clinic-open-yet
-- SECURITY DEFINER + row_security off, owned by glowpt_auth, exactly like
-- auth_role/auth_clinic_id/is_my_patient — a policy that reads a table under
-- FORCE RLS must not re-enter RLS or it recurses.
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

alter function public.clinic_is_active(uuid) owner to glowpt_auth;
grant execute on function public.clinic_is_active(uuid) to glowpt_app;

-- --------------------------------------------------------- 3. the gate itself
-- (a) No new patient can attach to a clinic that is not switched on.
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

  -- The gate. Checked here rather than in the UI so it holds regardless of
  -- what the frontend does, or whether the frontend is the caller at all.
  if not public.clinic_is_active(v_clinic) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
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

alter function public.join_clinic(text, text, text) owner to glowpt_auth;

-- (b) No PHI may be written for an inactive clinic, even by a patient who is
--     already attached. Blocking only the join would leave that hole open.
drop policy if exists checkins_insert_own on public.checkins;
create policy checkins_insert_own on public.checkins
  for insert to glowpt_app
  with check (user_id = public.current_user_id()
              and clinic_id = public.auth_clinic_id()
              and public.clinic_is_active(clinic_id));

drop policy if exists checkins_update_own on public.checkins;
create policy checkins_update_own on public.checkins
  for update to glowpt_app
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id()
              and clinic_id = public.auth_clinic_id()
              and public.clinic_is_active(clinic_id));

-- (c) The public /join page can tell the difference between "no such clinic"
--     and "not open yet", so a patient gets a sentence instead of a thrown error.
-- DROP first, not "create or replace": adding is_active changes the function's
-- OUT parameters, and Postgres refuses to replace a function whose return type
-- differs. Inside this transaction the old definition stays visible to other
-- sessions until commit, so the live /join lookup never sees it missing.
drop function if exists public.get_clinic_by_slug(text);

create function public.get_clinic_by_slug(p_slug text)
  returns table (id uuid, name text, slug text, is_active boolean)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.id, c.name, c.slug, (c.activated_at is not null) as is_active
  from public.clinics c
  where c.slug = lower(trim(p_slug))
$$;

alter function public.get_clinic_by_slug(text) owner to glowpt_auth;
grant execute on function public.get_clinic_by_slug(text) to glowpt_app;

-- Staff paths are deliberately NOT gated: a manager must be able to sign in to
-- an inactive clinic to read the banner, and an invited therapist carries no
-- PHI by existing. The gate is on patient enrolment and check-ins, which is
-- where PHI actually enters.

-- --------------------------------------------------------- 4. platform admins
-- Cross-clinic identity. Deliberately its own table rather than a profiles
-- role: profiles are clinic-scoped by design and every RLS policy assumes it.
create table if not exists public.platform_admins (
  user_id  uuid primary key references public.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
-- NO policies, and no grants to glowpt_app: the table is unreadable and
-- unwritable by the application role. Only the definer functions below see it,
-- so a compromised app role cannot make itself an admin.

grant select on public.platform_admins to glowpt_auth;   -- is_platform_admin() reads it
grant select, insert on public.access_log to glowpt_auth; -- admin_* log their own actions
alter table public.platform_admins owner to glowpt_owner;

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$
  select exists (
    select 1 from public.platform_admins where user_id = public.current_user_id()
  )
$$;

alter function public.is_platform_admin() owner to glowpt_auth;
grant execute on function public.is_platform_admin() to glowpt_app;

-- ------------------------------------------------------- 5. the admin surface
-- Clinic-level only. No patient names, no check-in content, no PHI crosses a
-- clinic boundary here — counts and timestamps only. Manager contact is
-- included because operating the switch means emailing the clinic, and a
-- clinic manager's work email is not patient health information.
create or replace function public.admin_list_clinics()
  returns table (
    id             uuid,
    name           text,
    slug           text,
    created_at     timestamptz,
    activated_at   timestamptz,
    baa_signed_at  timestamptz,
    baa_version    text,
    manager_name   text,
    manager_email  text,
    patient_count  bigint,
    staff_count    bigint,
    checkins_7d    bigint,
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

alter function public.admin_list_clinics() owner to glowpt_auth;
grant execute on function public.admin_list_clinics() to glowpt_app;

-- The switch. Flipping OFF is deliberately allowed: if something goes wrong at
-- a clinic, stopping new PHI must not require a deploy.
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

alter function public.admin_set_clinic_active(uuid, boolean) owner to glowpt_auth;
grant execute on function public.admin_set_clinic_active(uuid, boolean) to glowpt_app;

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

alter function public.admin_record_baa(uuid, text) owner to glowpt_auth;
grant execute on function public.admin_record_baa(uuid, text) to glowpt_app;

-- ------------------------------------------- 6. don't break what already runs
-- Every clinic that exists today predates the gate. Left alone they would all
-- go dark: the Riverside sales demo would stop accepting check-ins and the
-- Weekly Test PT Monday heartbeat would go quiet, which is the alarm, not a
-- fix. Activated explicitly, and only these.
update public.clinics
   set activated_at = coalesce(activated_at, now())
 where activated_at is null;

commit;
