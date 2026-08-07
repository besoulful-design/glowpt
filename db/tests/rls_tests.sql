-- GlowPT Phase 1.3 tests. Run as role glowpt_app (the app's login role).
-- Seeds a realistic 2-clinic world through the real RPCs, then runs attacks.
-- Expected-to-fail attacks are wrapped so a caught error = PASS.

\set QUIET on
set client_min_messages = notice;

-- =================== SEED IDENTITIES (post-confirmation Lambda stand-in) ===================
select register_user('11111111-1111-1111-1111-111111111111','mgra@a.com','Mgr A');
select register_user('22222222-2222-2222-2222-222222222222','pata1@a.com','Pat A1');
select register_user('33333333-3333-3333-3333-333333333333','pata2@a.com','Pat A2');
select register_user('44444444-4444-4444-4444-444444444444','thera@a.com','Ther A');
select register_user('55555555-5555-5555-5555-555555555555','mgrb@b.com','Mgr B');
select register_user('66666666-6666-6666-6666-666666666666','patb1@b.com','Pat B1');

-- =================== BUILD CLINIC A (the real way, via RPCs) ===================
begin; select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true);
  select provision_clinic('Clinic A','clinic-a'); commit;
begin; select set_config('app.user_id','22222222-2222-2222-2222-222222222222',true);
  select join_clinic('clinic-a','Pat A1','v1'); commit;
begin; select set_config('app.user_id','33333333-3333-3333-3333-333333333333',true);
  select join_clinic('clinic-a','Pat A2','v1'); commit;
-- manager invites therapist; therapist accepts; manager assigns Pat A1 to therapist
begin; select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true);
  select invite_staff('thera@a.com','Ther A','therapist'); commit;
begin; select set_config('app.user_id','44444444-4444-4444-4444-444444444444',true);
  select accept_staff_invite(); commit;
begin; select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true);
  select assign_therapist('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444'); commit;

-- =================== BUILD CLINIC B ===================
begin; select set_config('app.user_id','55555555-5555-5555-5555-555555555555',true);
  select provision_clinic('Clinic B','clinic-b'); commit;
begin; select set_config('app.user_id','66666666-6666-6666-6666-666666666666',true);
  select join_clinic('clinic-b','Pat B1','v1'); commit;

-- =================== CHECK-INS (legit, via RLS insert) ===================
begin; select set_config('app.user_id','22222222-2222-2222-2222-222222222222',true);
  insert into checkins (user_id, clinic_id, feeling, feeling_word)
    values (current_user_id(), auth_clinic_id(), 4, 'Good'); commit;
begin; select set_config('app.user_id','33333333-3333-3333-3333-333333333333',true);
  insert into checkins (user_id, clinic_id, feeling, feeling_word)
    values (current_user_id(), auth_clinic_id(), 2, 'Tough'); commit;
begin; select set_config('app.user_id','66666666-6666-6666-6666-666666666666',true);
  insert into checkins (user_id, clinic_id, feeling, feeling_word)
    values (current_user_id(), auth_clinic_id(), 5, 'Great'); commit;

\set QUIET off
-- ================================ TESTS ================================
do $$
declare
  pat_a1 uuid := '22222222-2222-2222-2222-222222222222';
  clinic_b uuid;
  n int;
  denied boolean;
begin
  select id from public.clinics where slug='clinic-b' into clinic_b;

  -- T1 HOLE 1: patient tries to promote self to manager  (expect DENIED)
  perform set_config('app.user_id', pat_a1::text, true);
  denied := false;
  begin
    update public.profiles set role='manager' where id = pat_a1;
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T1 self-promote to manager', case when denied then 'PASS:' else 'FAIL:' end;

  -- T2 HOLE 1: patient tries to move self to clinic B  (expect DENIED)
  denied := false;
  begin
    update public.profiles set clinic_id = clinic_b where id = pat_a1;
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T2 self-reassign clinic', case when denied then 'PASS:' else 'FAIL:' end;

  -- T3 LEGIT: patient edits own full_name  (expect SUCCESS)
  update public.profiles set full_name = 'Pat A1 Edited' where id = pat_a1;
  select count(*) into n from public.profiles where id = pat_a1 and full_name='Pat A1 Edited';
  raise notice '% T3 edit own name', case when n=1 then 'PASS:' else 'FAIL:' end;

  -- T4 HOLE 2: NO identity set, insert a checkin  (expect DENIED by RLS)
  perform set_config('app.user_id', '', true);
  denied := false;
  begin
    insert into public.checkins (user_id, clinic_id, feeling)
      values ('66666666-6666-6666-6666-666666666666', clinic_b, 5);
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T4 anonymous checkin insert', case when denied then 'PASS:' else 'FAIL:' end;

  -- T5 HOLE 2: patient A1 inserts a checkin for patient B1 in clinic B  (expect DENIED)
  perform set_config('app.user_id', pat_a1::text, true);
  denied := false;
  begin
    insert into public.checkins (user_id, clinic_id, feeling)
      values ('66666666-6666-6666-6666-666666666666', clinic_b, 5);
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T5 forge checkin for another patient', case when denied then 'PASS:' else 'FAIL:' end;

  -- T6 HOLE 1 (insert side): create a fresh profile row as manager  (expect DENIED, no insert grant)
  denied := false;
  begin
    insert into public.profiles (id, role) values (gen_random_uuid(), 'manager');
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T6 self-insert profile as manager', case when denied then 'PASS:' else 'FAIL:' end;

  -- T7 CROSS-TENANT READ: manager A tries to read clinic B profiles  (expect 0 rows)
  perform set_config('app.user_id','11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from public.profiles where clinic_id = clinic_b;
  raise notice '% T7 manager A sees clinic B profiles (want 0) -> %', case when n=0 then 'PASS:' else 'FAIL:' end, n;

  -- T8 MANAGER SCOPING + NO RECURSION: manager A sees exactly clinic A members
  select count(*) into n from public.profiles;   -- RLS scopes automatically
  raise notice '% T8 manager A roster size (want 4: mgr+2pat+ther) -> %', case when n=4 then 'PASS:' else 'FAIL:' end, n;

  -- T9 THERAPIST CASELOAD: therapist A sees only assigned patient checkins
  perform set_config('app.user_id','44444444-4444-4444-4444-444444444444', true);
  select count(*) into n from public.checkins;    -- only Pat A1 (assigned), not Pat A2
  raise notice '% T9 therapist checkin visibility (want 1) -> %', case when n=1 then 'PASS:' else 'FAIL:' end, n;

  -- T10 STAFF REFUSED SELF-JOIN: therapist A tries to self-join as a patient  (expect RAISE)
  denied := false;
  begin
    perform public.join_clinic('clinic-a','Sneaky','v1');
  exception when others then denied := (sqlerrm like '%Staff account cannot self-join%'); end;
  raise notice '% T10 staff self-join refused', case when denied then 'PASS:' else 'FAIL:' end;

  -- T11 LEGIT: patient A1 sees own single checkin
  perform set_config('app.user_id', pat_a1::text, true);
  select count(*) into n from public.checkins;
  raise notice '% T11 patient sees own checkins (want 1) -> %', case when n=1 then 'PASS:' else 'FAIL:' end, n;

  -- T12 CROSS-TENANT via checkins: manager B must not see clinic A checkins
  perform set_config('app.user_id','55555555-5555-5555-5555-555555555555', true);
  select count(*) into n from public.checkins;    -- only clinic B has 1 (Pat B1)
  raise notice '% T12 manager B checkin visibility (want 1, clinic B only) -> %', case when n=1 then 'PASS:' else 'FAIL:' end, n;

  -- T13 TIGHTENING P2: a second check-in the same UTC day for the same patient
  -- (Pat A1 already has one from seeding) must be blocked by the unique index.
  perform set_config('app.user_id', pat_a1::text, true);
  denied := false;
  begin
    insert into public.checkins (user_id, clinic_id, feeling)
      values (current_user_id(), auth_clinic_id(), 3);
  exception when unique_violation then denied := true; end;
  raise notice '% T13 duplicate same-day checkin blocked', case when denied then 'PASS:' else 'FAIL:' end;

  -- T14 TIGHTENING P1: checkins.user_id is now NOT NULL at the schema level.
  select attnotnull into denied
    from pg_attribute
    where attrelid = 'public.checkins'::regclass and attname = 'user_id';
  raise notice '% T14 checkins.user_id is NOT NULL', case when denied then 'PASS:' else 'FAIL:' end;
end $$;
