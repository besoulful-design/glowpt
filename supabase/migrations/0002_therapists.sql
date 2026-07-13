-- GlowPT · V2.1 · Therapist caseloads + staff invites
-- Run in Supabase → SQL Editor AFTER 0001_multitenant.sql. Safe to re-run (idempotent).
-- Adds: (1) manager-invites-therapist-by-email flow, (2) manager assigns patients to
-- therapists, (3) therapists see ONLY their assigned patients (enforced by RLS).

-- =====================================================================
-- 1. STAFF INVITES — a manager invites a therapist (or co-manager) by email.
--    The person becomes staff automatically on their first sign-in.
-- =====================================================================
create table if not exists public.staff_invites (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  email        text not null,                       -- stored lowercased
  full_name    text,
  role         text not null default 'therapist' check (role in ('therapist','manager')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz,                          -- set when they sign in and accept
  unique (clinic_id, email)
);
create index if not exists staff_invites_email_idx on public.staff_invites(email) where consumed_at is null;

alter table public.staff_invites enable row level security;
-- Managers can see their own clinic's invites (to show "pending" therapists).
drop policy if exists staff_invites_select_clinic on public.staff_invites;
create policy staff_invites_select_clinic on public.staff_invites
  for select to authenticated using (auth_role() = 'manager' and clinic_id = auth_clinic_id());
-- All writes go through SECURITY DEFINER functions below, so no insert/update policies.

-- Manager invites a staff member for THEIR clinic (re-inviting refreshes the invite).
create or replace function public.invite_staff(p_email text, p_full_name text, p_role text default 'therapist')
  returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, auth.uid())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null;
end;
$$;
grant execute on function public.invite_staff(text, text, text) to authenticated;

-- Called on first sign-in: if the signed-in email has a pending invite, attach them
-- as staff to that clinic. Returns the clinic_id, or null if no invite. Role is set
-- server-side from the invite — the client never chooses its own role.
create or replace function public.accept_staff_invite()
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text; v_inv record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select email from auth.users where id = auth.uid() into v_email;
  select * from public.staff_invites
    where email = lower(v_email) and consumed_at is null
    order by created_at desc limit 1 into v_inv;
  if v_inv.id is null then return null; end if;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (auth.uid(), v_inv.clinic_id, v_inv.role, v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = v_inv.role,
          full_name = coalesce(profiles.full_name, v_inv.full_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end;
$$;
grant execute on function public.accept_staff_invite() to authenticated;

-- =====================================================================
-- 2. ASSIGN A PATIENT TO A THERAPIST (manager only, same clinic).
--    Pass null therapist to unassign.
-- =====================================================================
create or replace function public.assign_therapist(p_patient uuid, p_therapist uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can assign therapists'; end if;
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic';
  end if;
  if p_therapist is not null and not exists (
      select 1 from public.profiles
      where id = p_therapist and clinic_id = v_clinic and role = 'therapist') then
    raise exception 'Therapist not in your clinic';
  end if;
  update public.profiles set therapist_id = p_therapist where id = p_patient;
end;
$$;
grant execute on function public.assign_therapist(uuid, uuid) to authenticated;

-- =====================================================================
-- 3. RLS: scope therapists to their OWN caseload; managers still see all.
--    (Replaces the old therapist-sees-whole-clinic policies from 0001.)
-- =====================================================================
-- Helper (SECURITY DEFINER) avoids RLS recursion when a policy checks assignment.
create or replace function public.is_my_patient(p_user uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = p_user and therapist_id = auth.uid());
$$;

-- PROFILES: manager reads the whole clinic; therapist reads only assigned patients
-- (plus always their own row via the existing profiles_select_self policy).
drop policy if exists profiles_select_clinic on public.profiles;
create policy profiles_select_clinic on public.profiles
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());
drop policy if exists profiles_select_caseload on public.profiles;
create policy profiles_select_caseload on public.profiles
  for select to authenticated
  using (auth_role() = 'therapist' and therapist_id = auth.uid());

-- CHECKINS: manager reads the whole clinic; therapist reads only assigned patients'.
drop policy if exists checkins_select_clinic on public.checkins;
create policy checkins_select_clinic on public.checkins
  for select to authenticated
  using (auth_role() = 'manager' and clinic_id = auth_clinic_id());
drop policy if exists checkins_select_caseload on public.checkins;
create policy checkins_select_caseload on public.checkins
  for select to authenticated
  using (auth_role() = 'therapist' and clinic_id = auth_clinic_id() and public.is_my_patient(user_id));
