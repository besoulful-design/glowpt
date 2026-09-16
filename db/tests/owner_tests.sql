-- GlowPT: the checks the APP ROLE IS NOT ALLOWED TO MAKE. Run as the schema
-- owner, last, after invite_tests.sql has built and deleted Clinic D.
--
-- WHY A SEPARATE FILE (2026-09-16): public.users and public.clinic_deletions
-- carry no grant to glowpt_app whatsoever -- that is deliberate and is itself
-- tested. So the strongest assertions about a clinic deletion (that its people
-- are really gone, that the platform admin survived, that the ledger recorded
-- it) cannot be made from a suite running as glowpt_app: the query errors, the
-- DO block aborts, and the run just ends early looking fine.
--
-- Nothing here writes. It reads, by stable identifier rather than by an id
-- carried over from another file.
\set QUIET on
set client_min_messages = notice;

do $$
declare
  admin_id constant uuid := '77777777-7777-7777-7777-777777777777';
  n int;
begin
  -- T72b Clinic D's manager and patient went with the clinic: their users rows,
  -- and by cascade their profiles, consents and check-ins.
  select count(*) into n from public.users where email in ('mgrd@d.com', 'patd1@d.com');
  raise notice '% T72b the deleted clinic''s people are gone -> % row(s)',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  select count(*) into n from public.checkins k
   where k.note = 'a note that must not survive';
  raise notice '% T72c and their check-ins with them -> % row(s)',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- T73 ⛔ THE PLATFORM ADMIN SURVIVED, detached rather than deleted. If this
  -- ever fails, deleting Riverside PT locks David out of his own /admin.
  select count(*) into n from public.users where id = admin_id;
  raise notice '% T73 the platform admin still exists -> %',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;
  select count(*) into n from public.profiles where id = admin_id and clinic_id is null;
  raise notice '% T73b and is detached from the clinic, not deleted -> %',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T74 the ledger remembers WHICH clinic. An access_log row cannot: its
  -- clinic_id is nulled the moment the clinic row goes.
  select count(*) into n from public.clinic_deletions
   where clinic_slug = 'clinic-d' and clinic_name = 'Clinic D'
     and patient_count = 1 and staff_count = 2 and deleted_by = admin_id;
  raise notice '% T74 the deletion is recorded by name -> % row',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T75 and the app role still cannot read that ledger, which is the other half
  -- of why this file exists.
  begin
    perform 1 from public.clinic_deletions;  -- as owner: fine
    select count(*) into n from information_schema.role_table_grants
     where table_name = 'clinic_deletions' and grantee = 'glowpt_app';
    raise notice '% T75 glowpt_app holds no grant on the deletion ledger -> % grant(s)',
      case when n = 0 then 'PASS:' else 'FAIL:' end, n;
  end;
end $$;
