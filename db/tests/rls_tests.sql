-- GlowPT Phase 1.3 tests. Run as role glowpt_app (the app's login role).
-- Seeds a realistic 2-clinic world through the real RPCs, then runs attacks.
-- Expected-to-fail attacks are wrapped so a caught error = PASS.
--
-- PREREQUISITE: db/tests/seed_identities.sql has already run (as
-- glowpt_postconfirm) to create the six users below. glowpt_app can no longer
-- call register_user itself (that is exactly what T15 asserts).

\set QUIET on
set client_min_messages = notice;

-- =================== BUILD CLINIC A (the real way, via RPCs) ===================
-- NOTE: provision_clinic now creates a CLOSED clinic. Every join below would be
-- refused until the platform admin switches it on — which is the gate working,
-- and is asserted directly in T17. The admin row itself is seeded by run_tests.sh
-- as the schema owner, because glowpt_app deliberately cannot write that table.
begin; select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true);
  select provision_clinic('Clinic A','clinic-a'); commit;
begin; select set_config('app.user_id','77777777-7777-7777-7777-777777777777',true);
  select admin_set_clinic_active((select id from admin_list_clinics() where slug='clinic-a'), true); commit;
-- A new clinic is invite-only, so the seed's self-serve joins below would be
-- refused. The manager opts into walk-ins first, which is the real RPC and is
-- asserted directly in T36/T37.
begin; select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true);
  select set_clinic_open_signup(true); commit;
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
begin; select set_config('app.user_id','77777777-7777-7777-7777-777777777777',true);
  select admin_set_clinic_active((select id from admin_list_clinics() where slug='clinic-b'), true); commit;
begin; select set_config('app.user_id','55555555-5555-5555-5555-555555555555',true);
  select set_clinic_open_signup(true); commit;
begin; select set_config('app.user_id','66666666-6666-6666-6666-666666666666',true);
  select join_clinic('clinic-b','Pat B1','v1'); commit;

-- =========== BUILD CLINIC C (provisioned, deliberately left CLOSED) ===========
begin; select set_config('app.user_id','88888888-8888-8888-8888-888888888888',true);
  select provision_clinic('Clinic C','clinic-c'); commit;

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
  pat_c1 uuid := '99999999-9999-9999-9999-999999999999';
  admin_id uuid := '77777777-7777-7777-7777-777777777777';
  clinic_b uuid;
  clinic_c uuid;
  n int;
  denied boolean;
begin
  select id from public.clinics where slug='clinic-b' into clinic_b;
  -- The admin holds no profile anywhere, so a plain select on clinics returns
  -- nothing for them under RLS. admin_list_clinics() is their only view — and
  -- resolving clinic C through it proves the cross-clinic read works.
  perform set_config('app.user_id', admin_id::text, true);
  select id from public.admin_list_clinics() where slug='clinic-c' into clinic_c;

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

  -- T15 LEAST PRIVILEGE (Phase 2): glowpt_app must NOT be able to mint an
  -- identity. Only glowpt_postconfirm holds EXECUTE on register_user now.
  perform set_config('app.user_id', pat_a1::text, true);
  denied := false;
  begin
    perform public.register_user(gen_random_uuid(), 'evil@x.com', 'Evil');
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T15 glowpt_app cannot call register_user', case when denied then 'PASS:' else 'FAIL:' end;

  -- ===================== ACTIVATION GATE (2026-08-26) =====================
  -- T17 GATE: a clinic is CLOSED when provisioned. Pat C1 cannot join it.
  perform set_config('app.user_id', pat_c1::text, true);
  denied := false;
  begin
    perform public.join_clinic('clinic-c','Pat C1','v1');
  exception when others then denied := (sqlerrm like '%not open for sign-ups%'); end;
  raise notice '% T17 join refused while clinic is closed', case when denied then 'PASS:' else 'FAIL:' end;

  -- T17b THE TWO GATES ARE INDEPENDENT. The admin switches clinic C on, and the
  -- self-serve join is STILL refused, because a new clinic is invite-only until
  -- its manager asks for walk-ins. Activation is "may this clinic operate";
  -- open_signup is "how does it enrol". Different questions, different answers.
  perform set_config('app.user_id', admin_id::text, true);
  perform public.admin_set_clinic_active(clinic_c, true);
  perform set_config('app.user_id', pat_c1::text, true);
  denied := false;
  begin
    perform public.join_clinic('clinic-c','Pat C1','v1');
  exception when others then denied := (sqlerrm like '%invite only%'); end;
  raise notice '% T17b an active clinic still refuses walk-ins while invite-only',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T18 SWITCH ON: the manager opens walk-ins, and the same join now succeeds.
  perform set_config('app.user_id', '88888888-8888-8888-8888-888888888888', true);
  perform public.set_clinic_open_signup(true);
  perform set_config('app.user_id', pat_c1::text, true);
  perform public.join_clinic('clinic-c','Pat C1','v1');
  select count(*) into n from public.profiles where id = pat_c1 and clinic_id = clinic_c;
  raise notice '% T18 join succeeds once both gates are open', case when n=1 then 'PASS:' else 'FAIL:' end;

  -- T19 SWITCH OFF: an ALREADY-ATTACHED patient cannot write PHI to a clinic
  -- that has been switched back off. Gating only the join would miss this.
  perform set_config('app.user_id', admin_id::text, true);
  perform public.admin_set_clinic_active(clinic_c, false);
  perform set_config('app.user_id', pat_c1::text, true);
  denied := false;
  begin
    insert into public.checkins (user_id, clinic_id, feeling)
      values (current_user_id(), clinic_c, 3);
  exception when insufficient_privilege or check_violation then denied := true;
            when others then denied := true; end;
  raise notice '% T19 check-in refused while clinic is switched off', case when denied then 'PASS:' else 'FAIL:' end;

  -- T20 AUTHZ: an ordinary patient cannot flip anyone's switch.
  perform set_config('app.user_id', pat_a1::text, true);
  denied := false;
  begin
    perform public.admin_set_clinic_active(clinic_c, true);
  exception when insufficient_privilege then denied := true;
            when others then denied := (sqlerrm like '%Not authorised%'); end;
  raise notice '% T20 non-admin cannot activate a clinic', case when denied then 'PASS:' else 'FAIL:' end;

  -- T21 AUTHZ: nor read the cross-clinic operator list.
  denied := false;
  begin
    perform * from public.admin_list_clinics();
  exception when insufficient_privilege then denied := true;
            when others then denied := (sqlerrm like '%Not authorised%'); end;
  raise notice '% T21 non-admin cannot list clinics', case when denied then 'PASS:' else 'FAIL:' end;

  -- T22 LEAST PRIVILEGE: glowpt_app cannot read platform_admins directly, so it
  -- cannot enrol itself as an admin even knowing the table exists.
  denied := false;
  begin
    select count(*) into n from public.platform_admins;
  exception when insufficient_privilege then denied := true; end;
  raise notice '% T22 glowpt_app cannot read platform_admins', case when denied then 'PASS:' else 'FAIL:' end;

  -- T23 LEGIT: the admin sees all three clinics, and no PHI columns exist to see.
  perform set_config('app.user_id', admin_id::text, true);
  select count(*) into n from public.admin_list_clinics();
  raise notice '% T23 admin sees every clinic (want 3) -> %', case when n=3 then 'PASS:' else 'FAIL:' end, n;
end $$;
