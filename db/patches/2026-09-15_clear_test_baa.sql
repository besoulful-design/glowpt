-- ============================================================================
-- 2026-09-15 — clear one BAA date that was recorded by mistake.
--
-- WHY: David tapped "Record BAA Signed" on Top of the Hill PT while walking
-- through a brand new clinic. Nothing was signed. That wrote baa_signed_at and
-- a BAA version onto the row, and at the time there was no way back, which is
-- what prompted admin_clear_baa in the patch beside this one.
--
-- ⚠️ THIS IS A DBA CORRECTION, NOT THE PRODUCT PATH, and it exists because the
-- product path deliberately cannot do it: admin_clear_baa refuses while a clinic
-- is switched ON, and Top of the Hill PT is on, with a real check-in in it. The
-- honest sequence through the app (switch off, clear, switch on) is now blocked
-- at the last step by the very gate this pair of patches installs.
--
-- ⚠️ NO access_log ROW IS WRITTEN. The log records what a person did through
-- the app; this was done with the master credential, and pretending otherwise
-- would put a false actor in an audit trail to tidy up a false date. This file
-- and its commit are the record.
--
-- The clinic stays SWITCHED ON afterwards, exactly like Riverside PT and
-- RidgePT, which have run without a BAA record all along. ⚠️ If it is ever
-- switched off, a BAA must be recorded before it can come back on. That is the
-- new rule working, not a fault.
--
-- SAFE TO RUN: touches one named row, re-runnable, and the guard refuses if it
-- would hit any other number of rows.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare n int;
begin
  select count(*) into n from public.clinics where slug = 'top-of-the-hill-pt';
  if n <> 1 then raise exception 'GUARD: expected exactly 1 clinic, found %', n; end if;
end $$;

update public.clinics
   set baa_signed_at = null, baa_version = null
 where slug = 'top-of-the-hill-pt';

do $$
declare n int;
begin
  select count(*) into n from public.clinics
   where slug = 'top-of-the-hill-pt' and baa_signed_at is null and baa_version is null;
  if n <> 1 then raise exception 'GUARD: the BAA date is still set'; end if;

  -- The other clinics must be untouched. This file names one row on purpose.
  select count(*) into n from public.clinics where baa_signed_at is not null;
  raise notice 'PATCH OK: Top of the Hill PT has no BAA record. Clinics still carrying one: %', n;
end $$;

commit;
