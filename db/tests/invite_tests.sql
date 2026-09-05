-- GlowPT staff-invite-link tests. Run as role glowpt_app, AFTER rls_tests.sql
-- (which builds Clinic A) and after run_tests.sh has seeded one already-expired
-- invite as the schema owner.
--
-- What these exist to prove, in one sentence: the token in an invite link says
-- WHICH invite is being claimed and nothing more, so holding the link is never
-- enough to become staff of a clinic and read its patients' health records.
--
-- Expected-to-fail attacks are wrapped so a caught error = PASS.

\set QUIET on
set client_min_messages = notice;

do $$
declare
  mgr_a  constant uuid := '11111111-1111-1111-1111-111111111111';
  newst  constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  wrongp constant uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  expird constant uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  newpat constant uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  -- A Cognito account with NO public.users row: the account exists (someone
  -- abandoned a sign-up at the code screen, so lib/cognito.js signed them in
  -- instead of confirming them) but register_user never ran for it.
  ghost  constant uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  ptok text; clinic_a uuid;
  tok text; tok2 text; expired_tok text;
  denied boolean; n int; r record; clinic uuid;
begin
  -- ---- Manager A invites a new therapist and gets a link back. ----
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_staff('newstaff@a.com','New Staff','therapist') into tok;

  raise notice '% T24 invite_staff returns a token (64 hex chars) -> %',
    case when tok ~ '^[0-9a-f]{64}$' then 'PASS:' else 'FAIL:' end, coalesce(length(tok),0);

  -- ---- The unauthenticated lookup the sign-up screen uses. ----
  perform set_config('app.user_id', '', true);
  select * from get_staff_invite(tok) into r;
  raise notice '% T25 get_staff_invite names the clinic and role -> % / %',
    case when r.clinic_name = 'Clinic A' and r.role = 'therapist'
          and r.email = 'newstaff@a.com' then 'PASS:' else 'FAIL:' end,
    coalesce(r.clinic_name,'(none)'), coalesce(r.role,'(none)');

  -- T26 An unknown token is simply not found. No error, nothing to enumerate.
  select count(*) into n from get_staff_invite('deadbeef');
  raise notice '% T26 unknown token returns no invite -> % rows',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- ---- THE CENTRAL ONE. Someone else holds the link. ----
  -- T27 AUTHZ: the token identifies the invite; the VERIFIED email is the gate.
  perform set_config('app.user_id', wrongp::text, true);
  denied := false;
  begin
    perform accept_staff_invite(tok);
  exception when others then denied := (sqlerrm like '%different email address%'); end;
  raise notice '% T27 a link holder with the wrong email cannot claim the role',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T28 And they gained nothing by trying: still no clinic, still not staff.
  select count(*) into n from profiles where id = wrongp and clinic_id is not null;
  raise notice '% T28 the failed attempt attached them to nothing -> % rows',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- T29 A forged token is refused outright.
  perform set_config('app.user_id', newst::text, true);
  denied := false;
  begin
    perform accept_staff_invite('0000000000000000000000000000000000000000000000000000000000000000');
  exception when others then denied := (sqlerrm like '%no longer valid%'); end;
  raise notice '% T29 a forged token is refused', case when denied then 'PASS:' else 'FAIL:' end;

  -- T30 An EXPIRED invite is refused. (Row seeded already-expired by the owner.)
  --
  -- ⚠️ Read the token AS THE MANAGER. staff_invites is RLS-scoped to the manager
  -- of its own clinic, so any other identity selects zero rows and this test
  -- would hand accept_staff_invite a null token — which silently takes the
  -- email-only safety-net branch and returns null instead of raising, so the
  -- test passes for the wrong reason. That is exactly how it failed when first
  -- written; the policy was doing its job.
  perform set_config('app.user_id', mgr_a::text, true);
  select token from staff_invites where email = 'expired@a.com' into expired_tok;
  perform set_config('app.user_id', expird::text, true);
  denied := false;
  begin
    perform accept_staff_invite(expired_tok);
  exception when others then denied := (sqlerrm like '%no longer valid%'); end;
  raise notice '% T30 an expired invite link is refused -> token %',
    case when denied and expired_tok is not null then 'PASS:' else 'FAIL:' end,
    case when expired_tok is null then 'NOT READ' else 'read' end;

  -- T30b The blind safety-net path (no token) must ignore an expired invite too,
  -- or an expired invitee would still be attached on their next sign-in.
  select accept_staff_invite() into clinic;
  select count(*) into n from profiles where id = expird and clinic_id is not null;
  raise notice '% T30b the no-token safety net also ignores an expired invite -> % rows',
    case when clinic is null and n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- T31 LEGIT: the invited person, signed in as themselves, becomes a therapist
  -- of the inviting clinic. The role comes off the invite row, not the caller.
  perform set_config('app.user_id', newst::text, true);
  select accept_staff_invite(tok) into clinic;
  select count(*) into n from profiles
    where id = newst and role = 'therapist'
      and clinic_id = (select id from clinics where slug = 'clinic-a');
  raise notice '% T31 the invited person becomes a therapist of Clinic A -> % rows',
    case when n = 1 and clinic is not null then 'PASS:' else 'FAIL:' end, n;

  -- T32 Single use: replaying the same link is refused.
  denied := false;
  begin
    perform accept_staff_invite(tok);
  exception when others then denied := (sqlerrm like '%no longer valid%'); end;
  raise notice '% T32 a consumed invite link cannot be replayed',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T33 Re-inviting the same address mints a FRESH token, and that is what
  -- invalidates a link that went to the wrong place. The old one stays dead.
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_staff('newstaff@a.com','New Staff','therapist') into tok2;
  raise notice '% T33 re-inviting mints a different token',
    case when tok2 is distinct from tok then 'PASS:' else 'FAIL:' end;

  perform set_config('app.user_id', newst::text, true);
  denied := false;
  begin
    perform accept_staff_invite(tok);
  exception when others then denied := (sqlerrm like '%no longer valid%'); end;
  raise notice '% T34 the superseded link is dead', case when denied then 'PASS:' else 'FAIL:' end;

  -- T35 AUTHZ: a patient cannot mint invites, so cannot manufacture a link that
  -- would make anyone staff. (Pat A1 is a patient of Clinic A.)
  perform set_config('app.user_id', '22222222-2222-2222-2222-222222222222', true);
  denied := false;
  begin
    perform invite_staff('anyone@a.com','Anyone','manager');
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T35 a patient cannot create a staff invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- =================== PATIENT INVITES ===================
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_patient('newpat@a.com','New Patient') into ptok;
  select id from clinics where slug = 'clinic-a' into clinic_a;

  perform set_config('app.user_id', '', true);
  select * from get_staff_invite(ptok) into r;
  raise notice '% T36 a patient invite reads back as a patient invite -> %',
    case when r.role = 'patient' and r.email = 'newpat@a.com' then 'PASS:' else 'FAIL:' end,
    coalesce(r.role,'(none)');

  -- T37 THE CONSENT GUARD. accept_staff_invite records no consent, so it must
  -- refuse a patient invite outright rather than attach someone who never
  -- agreed to the privacy notice.
  perform set_config('app.user_id', newpat::text, true);
  denied := false;
  begin
    perform accept_staff_invite(ptok);
  exception when others then denied := (sqlerrm like '%patient invite flow%'); end;
  raise notice '% T37 the staff door refuses a patient invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T37b And the blind safety net skips it too, so a patient invite is never
  -- claimed by a speculative retry on some later sign-in.
  select accept_staff_invite() into clinic;
  select count(*) into n from profiles where id = newpat and clinic_id is not null;
  raise notice '% T37b the no-token safety net skips patient invites -> % rows',
    case when clinic is null and n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- T38 Wrong holder, same rule as staff: the verified email is the gate.
  perform set_config('app.user_id', wrongp::text, true);
  denied := false;
  begin
    perform accept_patient_invite(ptok, 'v1');
  exception when others then denied := (sqlerrm like '%different email address%'); end;
  raise notice '% T38 a link holder with the wrong email cannot claim a patient invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T39 The patient door refuses a STAFF invite, the mirror of T37, so neither
  -- screen can be used to claim the other kind of account.
  perform set_config('app.user_id', newst::text, true);
  denied := false;
  begin
    perform accept_patient_invite(tok2, 'v1');
  exception when others then denied := (sqlerrm like '%staff invite flow%'); end;
  raise notice '% T39 the patient door refuses a staff invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T40 An invite is NOT a way around the activation gate.
  perform set_config('app.user_id', '77777777-7777-7777-7777-777777777777', true);
  perform admin_set_clinic_active(clinic_a, false);
  perform set_config('app.user_id', newpat::text, true);
  denied := false;
  begin
    perform accept_patient_invite(ptok, 'v1');
  exception when others then denied := (sqlerrm like '%not open for sign-ups%'); end;
  raise notice '% T40 an invited patient is still refused while the clinic is off',
    case when denied then 'PASS:' else 'FAIL:' end;
  perform set_config('app.user_id', '77777777-7777-7777-7777-777777777777', true);
  perform admin_set_clinic_active(clinic_a, true);

  -- T41 LEGIT: the invited patient joins, as a patient, WITH a consent row.
  perform set_config('app.user_id', newpat::text, true);
  select accept_patient_invite(ptok, 'v9-test') into clinic;
  select count(*) into n from profiles
    where id = newpat and role = 'patient' and clinic_id = clinic_a;
  raise notice '% T41 the invited patient is attached as a patient -> % rows',
    case when n = 1 and clinic is not null then 'PASS:' else 'FAIL:' end, n;

  select count(*) into n from consents
    where user_id = newpat and clinic_id = clinic_a and version = 'v9-test';
  raise notice '% T41b and their consent was recorded in the same breath -> % rows',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T42 AUTHZ: a patient cannot invite patients either.
  perform set_config('app.user_id', newpat::text, true);
  denied := false;
  begin
    perform invite_patient('someone@a.com','Someone');
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T42 a patient cannot invite patients',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T43 AUTHZ: nor flip their clinic back to open walk-ins.
  denied := false;
  begin
    perform set_clinic_open_signup(true);
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T43 a patient cannot open their clinic to walk-ins',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- ======================================================================
  -- The 2026-09-05 bug: a signed-in account with no public.users row.
  -- ======================================================================

  -- T44 SECURITY (regression): the email guard must FAIL CLOSED for a caller
  -- with no users row. Before the fix `lower(v_inv.email) <> lower(NULL)` was
  -- NULL rather than true, so the guard fell through and only the profiles
  -- foreign key stopped the claim. The guarantee has to be the check itself.
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_patient('ghost@a.com','Ghost') into ptok;
  perform set_config('app.user_id', ghost::text, true);
  denied := false;
  begin
    perform accept_patient_invite(ptok, 'v9-test');
  exception when others then
    denied := (sqlerrm like '%different email address%');
  end;
  raise notice '% T44 an unregistered caller is refused by the EMAIL guard, not the foreign key',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T44b the same guard on the staff door.
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_staff('ghoststaff@a.com','Ghost Staff','therapist') into tok2;
  perform set_config('app.user_id', ghost::text, true);
  denied := false;
  begin
    perform accept_staff_invite(tok2);
  exception when others then
    denied := (sqlerrm like '%different email address%');
  end;
  raise notice '% T44b and on the staff door too',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T45 LEGIT: ensure_self creates the missing identity row, and the invite the
  -- person actually holds then works. This is David's Felix case end to end.
  perform ensure_self('ghost@a.com');
  select accept_patient_invite(ptok, 'v9-test') into clinic;
  select count(*) into n from profiles
    where id = ghost and role = 'patient' and clinic_id = clinic_a;
  raise notice '% T45 ensure_self unblocks the invited patient -> % rows',
    case when n = 1 and clinic is not null then 'PASS:' else 'FAIL:' end, n;

  -- T46 ensure_self is idempotent: running it again changes nothing and does
  -- not disturb the clinic the person has just been attached to.
  perform ensure_self('ghost@a.com');
  select count(*) into n from profiles where id = ghost and clinic_id = clinic_a;
  raise notice '% T46 ensure_self is idempotent -> % rows',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T47 SECURITY: it refuses an address that already belongs to a different
  -- subject id. Silently proceeding would attach one person to another's row.
  perform set_config('app.user_id', '12121212-1212-1212-1212-121212121212', true);
  denied := false;
  begin
    perform ensure_self('ghost@a.com');
  exception when others then
    denied := (sqlerrm like '%already registered to another account%');
  end;
  raise notice '% T47 ensure_self refuses an address owned by another account',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T48 SECURITY: ensure_self takes no id, so it can only ever create the
  -- caller's own row. With no caller set there is nothing it can do.
  perform set_config('app.user_id', '', true);
  denied := false;
  begin
    perform ensure_self('anyone@a.com');
  exception when others then denied := (sqlerrm like '%Not authenticated%'); end;
  raise notice '% T48 ensure_self refuses an unauthenticated caller',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- ── Cancelling an invite, and removing a patient enrolled by mistake ──────

  -- T49 SECURITY: cancelling is a manager's power. A patient holding the app
  -- role must not be able to tear down their clinic's invites.
  perform set_config('app.user_id', newpat::text, true);
  denied := false;
  begin
    perform revoke_invite('expired@a.com');
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T49 a patient cannot cancel an invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T50 the manager cancels a pending invite and the row is gone. This is the
  -- wrong-address case: until now that invite stayed live for 14 days.
  perform set_config('app.user_id', mgr_a::text, true);
  perform revoke_invite('expired@a.com');
  select count(*) into n from staff_invites
   where clinic_id = clinic_a and lower(email) = 'expired@a.com';
  raise notice '% T50 a pending invite can be cancelled -> % rows left',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- T51 cancelling something that is not there says so, rather than silently
  -- reporting success — the house's recurring silent-failure shape.
  denied := false;
  begin
    perform revoke_invite('nobody@a.com');
  exception when others then denied := (sqlerrm like '%No pending invite%'); end;
  raise notice '% T51 cancelling a non-existent invite is refused',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T52 GUARD 2: a patient still on the roster cannot be removed. Discharge is
  -- the deliberate first step, so this can never be one click from the roster.
  denied := false;
  begin
    perform purge_patient(ghost);
  exception when others then denied := (sqlerrm like '%Discharge this patient first%'); end;
  raise notice '% T52 an active patient cannot be removed',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T53 GUARD 3, THE IMPORTANT ONE: a discharged patient WITH history is still
  -- refused. This is what keeps the feature a purge of mistakes rather than a
  -- delete of records.
  perform set_config('app.user_id', newpat::text, true);
  insert into checkins (user_id, clinic_id, feeling) values (newpat, clinic_a, 4);
  perform set_config('app.user_id', mgr_a::text, true);
  perform discharge_patient(newpat);
  denied := false;
  begin
    perform purge_patient(newpat);
  exception when others then denied := (sqlerrm like '%check-in(s), so their record is kept%'); end;
  raise notice '% T53 a discharged patient with check-ins is NOT removed',
    case when denied then 'PASS:' else 'FAIL:' end;
  select count(*) into n from profiles where id = newpat;
  raise notice '% T53b and they are still there -> % rows',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T54 the case this exists for: discharged, never checked in, so removing is
  -- clean. The users row goes and profiles cascades from it.
  -- NOTE: asserted through profiles, not users. glowpt_app has no SELECT on
  -- public.users at all — which is itself correct, and is why the first draft of
  -- this test failed with "permission denied for table users" while the function
  -- underneath had worked perfectly. Test what the app role can actually see.
  perform discharge_patient(ghost);
  perform purge_patient(ghost);
  select count(*) into n from profiles where id = ghost;
  raise notice '% T54 a discharged patient with no history is removed -> % rows',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;
  -- And genuinely gone rather than merely hidden by RLS: the function itself no
  -- longer finds them in this clinic.
  denied := false;
  begin
    perform purge_patient(ghost);
  exception when others then denied := (sqlerrm like '%Patient not in your clinic%'); end;
  raise notice '% T54b and gone for real, not just hidden',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T55 SECURITY: removing is a manager's power too.
  perform set_config('app.user_id', wrongp::text, true);
  denied := false;
  begin
    perform purge_patient(newpat);
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T55 a non-manager cannot remove a patient',
    case when denied then 'PASS:' else 'FAIL:' end;
end $$;
