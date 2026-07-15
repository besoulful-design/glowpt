-- GlowPT · V2.3 · (1) patients can edit their own check-in, (2) discharge (soft-delete)
-- Run in Supabase → SQL Editor AFTER 0002_therapists.sql. Safe to re-run (idempotent).
-- Nothing is ever deleted here.

-- (1) Let a patient UPDATE their own check-in. Needed so a same-day re-entry edits
--     today's entry instead of creating a duplicate row. Owner-only, matches the
--     existing checkins_insert_own / checkins_select_own policies.
drop policy if exists checkins_update_own on public.checkins;
create policy checkins_update_own on public.checkins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- (2) Discharge: a nullable `discharged_at` on profiles. A discharged patient is HIDDEN
--     from the roster + dashboards by the app, but their check-in data is KEPT and a
--     manager can restore them at any time.
alter table public.profiles add column if not exists discharged_at timestamptz;

-- Manager discharges a patient in THEIR clinic (soft delete — reversible).
create or replace function public.discharge_patient(p_patient uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can discharge patients'; end if;
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic';
  end if;
  update public.profiles set discharged_at = now() where id = p_patient;
end;
$$;
grant execute on function public.discharge_patient(uuid) to authenticated;

-- Manager restores a previously discharged patient in THEIR clinic.
create or replace function public.restore_patient(p_patient uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can restore patients'; end if;
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic';
  end if;
  update public.profiles set discharged_at = null where id = p_patient;
end;
$$;
grant execute on function public.restore_patient(uuid) to authenticated;
