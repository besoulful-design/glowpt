-- GlowPT · V2 · Data foundation (multi-clinic, consent, audit log)
-- Run in Supabase → SQL Editor. DEMO DATA ONLY until go-live (Team plan + BAAs).
-- Safe on the existing project: only ADDS tables/columns; does not drop `checkins` data.
-- Aligns to the existing checkins.user_id column (per the GlowPT project doc).

-- =====================================================================
-- 1. CLINICS  — one row per subscribing clinic
-- =====================================================================
create table if not exists public.clinics (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,        -- used in the patient link: /join/<slug>
  baa_signed_at  timestamptz,                 -- set at go-live when the clinic signs the BAA
  baa_version    text,
  created_at     timestamptz not null default now()
);

-- =====================================================================
-- 2. PROFILES  — links each auth login to a clinic + a role
--    role: 'patient' | 'therapist' | 'manager'
-- =====================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  clinic_id     uuid references public.clinics(id) on delete set null,
  role          text not null default 'patient'
                  check (role in ('patient','therapist','manager')),
  full_name     text,
  therapist_id  uuid references public.profiles(id) on delete set null, -- patient's assigned PT
  created_at    timestamptz not null default now()
);
create index if not exists profiles_clinic_idx    on public.profiles(clinic_id);
create index if not exists profiles_therapist_idx on public.profiles(therapist_id);

-- =====================================================================
-- 3. CHECKINS  — extend the EXISTING table (keeps its user_id column)
-- =====================================================================
alter table public.checkins add column if not exists clinic_id      uuid references public.clinics(id) on delete cascade;
alter table public.checkins add column if not exists other_movement text;
alter table public.checkins add column if not exists created_at     timestamptz not null default now();
create index if not exists checkins_user_idx   on public.checkins(user_id, created_at desc);
create index if not exists checkins_clinic_idx on public.checkins(clinic_id, created_at desc);

-- =====================================================================
-- 4. CONSENTS  — patient HIPAA acknowledgment (who / when / which version)
-- =====================================================================
create table if not exists public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  clinic_id     uuid references public.clinics(id) on delete set null,
  type          text not null default 'hipaa_patient_ack',
  version       text not null default 'v1',
  consented_at  timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents(user_id);

-- =====================================================================
-- 5. ACCESS_LOG  — application-layer audit trail for staff viewing patient data
--    (HIPAA access logging; infrastructure logs alone don't cover this)
-- =====================================================================
create table if not exists public.access_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid not null references auth.users(id) on delete cascade,
  action          text not null,               -- e.g. 'view_patient', 'view_roster'
  target_user_id  uuid,                         -- patient viewed, if any
  clinic_id       uuid references public.clinics(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists access_log_clinic_idx on public.access_log(clinic_id, created_at desc);

-- =====================================================================
-- 6. HELPER FUNCTIONS  (SECURITY DEFINER avoids RLS recursion on profiles)
-- =====================================================================
create or replace function public.auth_clinic_id()
  returns uuid language sql stable security definer set search_path = public as $$
    select clinic_id from public.profiles where id = auth.uid();
$$;

create or replace function public.auth_role()
  returns text language sql stable security definer set search_path = public as $$
    select role from public.profiles where id = auth.uid();
$$;

-- Self-serve clinic creation for the /onboard page: the signed-in user becomes
-- the new clinic's manager. SECURITY DEFINER so we don't need a broad insert policy.
create or replace function public.provision_clinic(p_name text, p_slug text)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_clinic_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.clinics (name, slug) values (p_name, p_slug) returning id into v_clinic_id;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (auth.uid(), v_clinic_id, 'manager', null)
    on conflict (id) do update set clinic_id = v_clinic_id, role = 'manager';
  return v_clinic_id;
end;
$$;
grant execute on function public.provision_clinic(text, text) to authenticated;

-- =====================================================================
-- 7. ROW-LEVEL SECURITY  — the core of multi-tenancy
-- =====================================================================
alter table public.clinics    enable row level security;
alter table public.profiles   enable row level security;
alter table public.checkins   enable row level security;
alter table public.consents   enable row level security;
alter table public.access_log enable row level security;

-- CLINICS: any authenticated user may read (needed to resolve a /join/<slug> link).
drop policy if exists clinics_select on public.clinics;
create policy clinics_select on public.clinics for select to authenticated using (true);

-- PROFILES
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_select_clinic on public.profiles;
create policy profiles_select_clinic on public.profiles
  for select to authenticated
  using (auth_role() in ('therapist','manager') and clinic_id = auth_clinic_id());
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- CHECKINS
drop policy if exists checkins_insert_own on public.checkins;
create policy checkins_insert_own on public.checkins
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists checkins_select_own on public.checkins;
create policy checkins_select_own on public.checkins
  for select to authenticated using (user_id = auth.uid());
drop policy if exists checkins_select_clinic on public.checkins;
create policy checkins_select_clinic on public.checkins
  for select to authenticated
  using (auth_role() in ('therapist','manager') and clinic_id = auth_clinic_id());

-- CONSENTS
drop policy if exists consents_insert_own on public.consents;
create policy consents_insert_own on public.consents
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists consents_select_own on public.consents;
create policy consents_select_own on public.consents
  for select to authenticated using (user_id = auth.uid());
drop policy if exists consents_select_clinic on public.consents;
create policy consents_select_clinic on public.consents
  for select to authenticated
  using (auth_role() in ('therapist','manager') and clinic_id = auth_clinic_id());

-- ACCESS_LOG: staff write their own actions; managers read their clinic's log.
drop policy if exists access_log_insert_own on public.access_log;
create policy access_log_insert_own on public.access_log
  for insert to authenticated with check (actor_id = auth.uid());
drop policy if exists access_log_select_clinic on public.access_log;
create policy access_log_select_clinic on public.access_log
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());

-- =====================================================================
-- 8. AUTO-CREATE A BARE PROFILE ON SIGNUP
-- =====================================================================
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
