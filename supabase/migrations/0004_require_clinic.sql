-- GlowPT · V2.4 · A check-in must belong to a clinic
-- Run in Supabase → SQL Editor AFTER 0003_discharge.sql. Safe to re-run (idempotent).
-- Nothing is deleted.
--
-- Background: /login creates an account for ANY email (signInWithOtp defaults to
-- shouldCreateUser: true). The signup trigger gives that account a bare profile with
-- clinic_id = null and role 'patient', and the router sent them straight into the
-- check-in — so their entries saved with clinic_id = null and were invisible to every
-- dashboard. The app now gates this (App.jsx → NoClinic.jsx); the rules below are the
-- database backstop, so an orphan check-in is impossible even if the UI is bypassed.

-- INSERT: the row's clinic must be the clinic the author actually belongs to.
-- auth_clinic_id() is null for an unattached user, and `clinic_id = null` is never
-- true, so an unattached user cannot insert a check-in at all.
drop policy if exists checkins_insert_own on public.checkins;
create policy checkins_insert_own on public.checkins
  for insert to authenticated
  with check (user_id = auth.uid() and clinic_id = auth_clinic_id());

-- UPDATE: same rule, so an existing check-in can't be moved to another clinic.
-- (The `using` clause stays owner-only so patients can still edit today's entry.)
drop policy if exists checkins_update_own on public.checkins;
create policy checkins_update_own on public.checkins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and clinic_id = auth_clinic_id());
