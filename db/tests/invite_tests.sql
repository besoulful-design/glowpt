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
  select invite_staff('newstaff@a.com','New','Staff','therapist') into tok;

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
  select invite_staff('newstaff@a.com','New','Staff','therapist') into tok2;
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
    perform invite_staff('anyone@a.com','Anyone',null,'manager');
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T35 a patient cannot create a staff invite',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- =================== PATIENT INVITES ===================
  perform set_config('app.user_id', mgr_a::text, true);
  select invite_patient('newpat@a.com','New','Patient') into ptok;
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
    perform invite_patient('someone@a.com','Someone','Person');
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
  select invite_patient('ghost@a.com','Ghost','Person') into ptok;
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
  select invite_staff('ghoststaff@a.com','Ghost','Staff','therapist') into tok2;
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

  -- T52 GUARD 2: a patient still on the roster cannot be removed. Archiving is
  -- the deliberate first step, so this can never be one click from the roster.
  -- (The UI calls it Archive; the column is still discharged_at.)
  denied := false;
  begin
    perform purge_patient(ghost);
  exception when others then denied := (sqlerrm like '%Archive this patient first%'); end;
  raise notice '% T52 an active patient cannot be removed',
    case when denied then 'PASS:' else 'FAIL:' end;

  -- T53 ⚠️ THIS TEST INVERTED ON 2026-09-06 AND THE INVERSION IS THE POINT. It
  -- used to assert that a patient with check-ins could NOT be removed. David's
  -- call: the manager is the covered entity, so destroying a real record is
  -- their decision, and the deliberateness lives in the typed-name confirmation
  -- on screen and the archive-first guard, not in a blanket refusal here.
  perform set_config('app.user_id', newpat::text, true);
  insert into checkins (user_id, clinic_id, feeling, local_date) values (newpat, clinic_a, 4, current_date);
  perform set_config('app.user_id', mgr_a::text, true);
  select count(*) into n from checkins where user_id = newpat;
  raise notice '% T53pre the patient really does have history first -> % check-in(s)',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;
  perform discharge_patient(newpat);
  perform purge_patient(newpat);
  select count(*) into n from profiles where id = newpat;
  raise notice '% T53 a patient WITH check-ins is removed once archived -> % rows',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;
  -- Their check-ins go with them: the whole point of the change.
  select count(*) into n from checkins where user_id = newpat;
  raise notice '% T53b and their check-ins went too -> % rows',
    case when n = 0 then 'PASS:' else 'FAIL:' end, n;
  -- The removal is recorded, WITHOUT naming who was removed.
  select count(*) into n from access_log
   where action = 'patient_removed' and actor_id = mgr_a and target_user_id is null;
  raise notice '% T53c the removal is audited, and does not name the patient -> % row',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T54 the original case: archived, never checked in, so removing is clean.
  -- The users row goes and profiles cascades from it.
  -- NOTE: asserted through profiles, not users. glowpt_app has no SELECT on
  -- public.users at all — which is itself correct, and is why the first draft of
  -- this test failed with "permission denied for table users" while the function
  -- underneath had worked perfectly. Test what the app role can actually see.
  perform discharge_patient(ghost);
  -- purge_target is the read half the API calls first, to learn the address for
  -- the Cognito delete. It must answer under the SAME guards and change nothing.
  select count(*) into n from public.purge_target(ghost);
  raise notice '% T54pre purge_target answers for a removable patient -> % row',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;
  select count(*) into n from profiles where id = ghost;
  raise notice '% T54pre2 and purge_target changed nothing -> % row still there',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;
  perform purge_patient(ghost);
  select count(*) into n from profiles where id = ghost;
  raise notice '% T54 an archived patient with no history is removed -> % rows',
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

  -- T55b the read half must be locked down exactly as hard. It hands back an
  -- email address, so if it were laxer than purge_patient it would be a way for
  -- any signed-in patient to look up another person's address.
  denied := false;
  begin
    perform public.purge_target(ghost);
  exception when others then denied := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T55b a non-manager cannot read a purge target either',
    case when denied then 'PASS:' else 'FAIL:' end;
end $$;

-- ===========================================================================
-- T56-T60: TWO NAME FIELDS (2026-09-13).
--
-- The roster is how a clinic tells one patient from another, and David's
-- clinics routinely have several patients sharing a first name AND a
-- therapist. So a patient invite must carry both parts, and the rule has to
-- live in the database rather than only in the form. Staff are deliberately
-- exempt: they are not on that roster, and the therapist who goes by
-- "PT Pete" has no surname to give.
--
-- T59 is the "PT Pete" regression. Until 2026-09-13 there was ONE full_name
-- and three separate places took everything before the first space as the
-- first name, so he was emailed as "Hi PT,". first_name is now verbatim.
-- ===========================================================================
do $$
declare
  mgr_a   constant uuid := '11111111-1111-1111-1111-111111111111';
  pat_a1  constant uuid := '22222222-2222-2222-2222-222222222222';
  refused boolean;
  fname   text;
  lname   text;
  composed text;
begin
  perform set_config('app.user_id', mgr_a::text, true);

  -- T56: a patient invite with no last name at all is refused.
  refused := false;
  begin
    perform invite_patient('nolast@a.com', 'Sarah', null);
  exception when others then refused := (sqlerrm like '%last name is required%'); end;
  raise notice '% T56 a patient invite needs a last name',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T56b: and whitespace is not a last name. btrim, not just a null test.
  refused := false;
  begin
    perform invite_patient('blanklast@a.com', 'Sarah', '   ');
  exception when others then refused := (sqlerrm like '%last name is required%'); end;
  raise notice '% T56b whitespace does not count as a last name',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T57: the first name is required on that door too.
  refused := false;
  begin
    perform invite_patient('nofirst@a.com', '  ', 'Jones');
  exception when others then refused := (sqlerrm like '%first name is required%'); end;
  raise notice '% T57 a patient invite needs a first name',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T58 ⚠️ THIS TEST INVERTED ON 2026-09-15 AND THE INVERSION IS THE POINT. It
  -- used to assert that a staff invite with NO last name succeeded, because
  -- staff are not on the patient roster. David's call is that a clinic has as
  -- many Sarahs on the care team as in the caseload, so every user now carries
  -- both parts and this door refuses what it used to allow.
  refused := false;
  begin
    perform invite_staff('nolaststaff@a.com', 'Sarah', null, 'therapist');
  exception when others then refused := (sqlerrm like '%last name is required%'); end;
  raise notice '% T58 a staff invite needs a last name too',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T58b: whitespace is not a last name here either.
  refused := false;
  begin
    perform invite_staff('blankstaff@a.com', 'Sarah', '   ', 'therapist');
  exception when others then refused := (sqlerrm like '%last name is required%'); end;
  raise notice '% T58b whitespace does not count on the staff door',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T58c: and the first name, which was only ever checked in the form.
  refused := false;
  begin
    perform invite_staff('nofirststaff@a.com', ' ', 'Jones', 'therapist');
  exception when others then refused := (sqlerrm like '%first name is required%'); end;
  raise notice '% T58c a staff invite needs a first name',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- The real invite the next two tests read. "PT Pete" keeps his verbatim first
  -- name; what changed is that he now gives a surname beside it.
  perform invite_staff('ptpete@a.com', 'PT Pete', 'Alvarez', 'therapist');
  select first_name, last_name into fname, lname
    from staff_invites where email = 'ptpete@a.com';
  raise notice '% T58d a staff invite with both names is accepted -> % / %',
    case when fname = 'PT Pete' and lname = 'Alvarez' then 'PASS:' else 'FAIL:' end,
    fname, coalesce(lname, 'null');

  -- T59 REGRESSION: first_name is stored verbatim, spaces and all. This is the
  -- whole point of two fields: nothing guesses where a name splits, so the
  -- greeting is "Hi PT Pete," and never "Hi PT,".
  raise notice '% T59 "PT Pete" survives as one first name -> %',
    case when fname = 'PT Pete' then 'PASS:' else 'FAIL:' end, fname;

  -- T60: full_name is DERIVED, so the two can never drift from it.
  select full_name into composed from staff_invites where email = 'ptpete@a.com';
  raise notice '% T60 full_name composes from the parts -> %',
    case when composed = 'PT Pete Alvarez' then 'PASS:' else 'FAIL:' end, coalesce(composed, 'null');

  -- T60b: and it is not writable, by anyone, including the app role. A write
  -- here is the drift this design exists to make impossible.
  perform set_config('app.user_id', pat_a1::text, true);
  refused := false;
  begin
    update public.profiles set full_name = 'Forged Name' where id = pat_a1;
  exception when others then refused := true; end;
  raise notice '% T60b full_name cannot be written, only derived',
    case when refused then 'PASS:' else 'FAIL:' end;
end $$;

-- ===========================================================================
-- T61-T65: rename_patient (2026-09-13).
--
-- A manager corrects a patient's name. Needed because three patients predate
-- two-field invites and have no surname at all, so the roster still cannot
-- tell them apart, and nothing in the app could fix that.
--
-- The refusals matter more than the success here: this is the only way one
-- person can write another person's name, so T63 (another clinic) and T64
-- (a colleague) are the tests that keep it narrow.
-- ===========================================================================
do $$
declare
  mgr_a   constant uuid := '11111111-1111-1111-1111-111111111111';
  mgr_b   constant uuid := '55555555-5555-5555-5555-555555555555';
  pat_a1  constant uuid := '22222222-2222-2222-2222-222222222222';
  ther_a  constant uuid := '44444444-4444-4444-4444-444444444444';
  refused boolean;
  composed text;
begin
  perform set_config('app.user_id', mgr_a::text, true);

  -- T61: the ordinary case, and full_name follows the parts.
  perform rename_patient(pat_a1, 'Sarah', 'Vandenberg');
  select full_name into composed from public.profiles where id = pat_a1;
  raise notice '% T61 a manager renames a patient in their clinic -> %',
    case when composed = 'Sarah Vandenberg' then 'PASS:' else 'FAIL:' end,
    coalesce(composed, 'null');

  -- T62: a last name is required, exactly as on the invite door. An edit that
  -- could blank a surname would undo the roster guarantee one row at a time.
  refused := false;
  begin
    perform rename_patient(pat_a1, 'Sarah', '  ');
  exception when others then refused := (sqlerrm like '%last name is required%'); end;
  raise notice '% T62 a rename cannot empty the last name',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T63 SECURITY: a manager of another clinic is refused. Clinic B's manager
  -- must not be able to touch clinic A's patient.
  perform set_config('app.user_id', mgr_b::text, true);
  refused := false;
  begin
    perform rename_patient(pat_a1, 'Hacked', 'Name');
  exception when others then refused := (sqlerrm like '%not in your clinic%'); end;
  raise notice '% T63 a manager of another clinic cannot rename this patient',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T64 SECURITY: patients only. A manager cannot rename a colleague, which is
  -- the same boundary assign_therapist / discharge / purge already draw.
  perform set_config('app.user_id', mgr_a::text, true);
  refused := false;
  begin
    perform rename_patient(ther_a, 'Renamed', 'Therapist');
  exception when others then refused := (sqlerrm like '%not in your clinic%'); end;
  raise notice '% T64 a manager cannot rename a therapist',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T65 SECURITY: a patient cannot rename anyone, including themselves through
  -- this door (their own name goes through the column-scoped update grant).
  perform set_config('app.user_id', pat_a1::text, true);
  refused := false;
  begin
    perform rename_patient(pat_a1, 'Self', 'Promoted');
  exception when others then refused := (sqlerrm like '%Only a clinic manager%'); end;
  raise notice '% T65 a patient cannot call rename_patient',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T65b: the rename is audited, and the log does NOT carry the name itself.
  perform set_config('app.user_id', mgr_a::text, true);
  select count(*)::text into composed from public.access_log
   where action = 'rename_patient' and target_user_id = pat_a1;
  raise notice '% T65b the rename is audited -> % row(s)',
    case when composed = '1' then 'PASS:' else 'FAIL:' end, composed;
end $$;

-- ===========================================================================
-- T66-T74: the clinic lifecycle (2026-09-16). Archive, export, delete.
--
-- David asked for the clinic equivalent of the patient roster's Archive and
-- Remove. The rules are the same ones, one level up: archiving is reversible
-- and switches the clinic off, deleting is only possible from archived, and it
-- takes the clinic's people with it.
--
-- ⚠️ THIS BLOCK BUILDS AND DESTROYS ITS OWN CLINIC D. Nothing else in the suite
-- touches it, because the point of these tests is that it stops existing.
-- ===========================================================================
do $$
declare
  admin_id constant uuid := '77777777-7777-7777-7777-777777777777';
  mgr_d    constant uuid := 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
  pat_d1   constant uuid := 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';
  mgr_a    constant uuid := '11111111-1111-1111-1111-111111111111';
  clinic_d uuid; refused boolean; n int; doc jsonb; tok text;
begin
  -- Build it the real way: the manager provisions, the admin records a BAA and
  -- switches it on, the manager invites a patient who claims the invite.
  perform set_config('app.user_id', mgr_d::text, true);
  select provision_clinic('Clinic D', 'clinic-d') into clinic_d;
  perform set_config('app.user_id', admin_id::text, true);
  perform admin_record_baa(clinic_d, 'v-test');
  perform admin_set_clinic_active(clinic_d, true);
  perform set_config('app.user_id', mgr_d::text, true);
  select invite_patient('patd1@d.com', 'Pat', 'D1') into tok;
  perform set_config('app.user_id', pat_d1::text, true);
  perform accept_patient_invite(tok, 'v1');
  -- ⚠️ THE PLATFORM ADMIN JOINS THIS CLINIC AS STAFF, through the real invite
  -- flow, because that is David's actual situation: he manages Riverside PT
  -- with the same address he administers GlowPT with. T71 and T73 are only
  -- worth anything if an admin is really inside the clinic being deleted.
  perform set_config('app.user_id', mgr_d::text, true);
  select invite_staff('admin@glowpt.app', 'Platform', 'Admin', 'therapist') into tok;
  perform set_config('app.user_id', admin_id::text, true);
  perform accept_staff_invite(tok);
  -- The patient's own check-in, written AS the patient: checkins is RLS-scoped
  -- to its author, so this insert fails from any other session user.
  perform set_config('app.user_id', pat_d1::text, true);
  insert into public.checkins (user_id, clinic_id, feeling, local_date, note)
    values (pat_d1, clinic_d, 4, current_date, 'a note that must not survive');

  -- T66 GUARD: a live clinic cannot be deleted. Archive is the first step, the
  -- same way a patient must be archived before removal.
  perform set_config('app.user_id', admin_id::text, true);
  refused := false;
  begin
    perform admin_clinic_purge_target(clinic_d);
  exception when others then refused := (sqlerrm like '%Archive this clinic first%'); end;
  raise notice '% T66 a live clinic cannot be deleted',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T67 the export hands back the records, and it carries the check-in text.
  select admin_export_clinic(clinic_d) into doc;
  raise notice '% T67 the export carries the clinic, its people and its check-ins -> % patient(s), % check-in(s)',
    case when doc->'clinic'->>'name' = 'Clinic D'
          and jsonb_array_length(doc->'patients') = 1
          and jsonb_array_length(doc->'checkins') = 1
          and doc->'checkins'->0->>'note' = 'a note that must not survive'
         then 'PASS:' else 'FAIL:' end,
    jsonb_array_length(doc->'patients'), jsonb_array_length(doc->'checkins');

  -- T67b the export is audited: handing a whole clinic's PHI to someone is an
  -- act, and the one place in the schema that deliberately does it says so.
  -- ⚠️ COUNTED AS THE CLINIC'S OWN MANAGER. access_log is RLS-scoped to a
  -- clinic's staff, so counting it as the admin (who is not staff there) would
  -- return zero however well the export worked.
  perform set_config('app.user_id', mgr_d::text, true);
  select count(*) into n from public.access_log
   where clinic_id = clinic_d and action = 'clinic_exported';
  perform set_config('app.user_id', admin_id::text, true);
  raise notice '% T67b the export is audited -> % row', case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T68 archiving switches the clinic OFF as well as filing it away.
  perform admin_archive_clinic(clinic_d, true);
  select count(*) into n from admin_list_clinics()
   where id = clinic_d and archived_at is not null and activated_at is null;
  raise notice '% T68 archiving a clinic also switches it off -> %',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T69 restoring un-files it but does NOT switch it back on: that gate needs
  -- the BAA and its own decision.
  perform admin_archive_clinic(clinic_d, false);
  select count(*) into n from admin_list_clinics()
   where id = clinic_d and archived_at is null and activated_at is null;
  raise notice '% T69 restoring does not switch the clinic back on -> %',
    case when n = 1 then 'PASS:' else 'FAIL:' end, n;

  -- T70 SECURITY: none of this is a manager's power, even their own clinic.
  perform set_config('app.user_id', mgr_d::text, true);
  refused := false;
  begin
    perform admin_archive_clinic(clinic_d, true);
  exception when others then refused := (sqlerrm like '%Not authorised%'); end;
  raise notice '% T70 a clinic manager cannot archive their own clinic',
    case when refused then 'PASS:' else 'FAIL:' end;
  refused := false;
  begin
    perform admin_export_clinic(clinic_d);
  exception when others then refused := (sqlerrm like '%Not authorised%'); end;
  raise notice '% T70b a clinic manager cannot export a clinic',
    case when refused then 'PASS:' else 'FAIL:' end;

  -- T71 the purge target names the logins to delete, and NEVER a platform
  -- admin. This is the guard that stops David deleting his own account with
  -- Riverside, which he administers GlowPT with.
  perform set_config('app.user_id', admin_id::text, true);
  perform admin_archive_clinic(clinic_d, true);
  select count(*) into n from admin_clinic_purge_target(clinic_d);
  -- THREE people are in this clinic and the target names TWO: the manager and
  -- the patient. The third is the platform admin, and leaving them out is what
  -- stops David deleting his own login along with Riverside PT.
  raise notice '% T71 the purge target skips the platform admin -> % of 3 members',
    case when n = 2 then 'PASS:' else 'FAIL:' end, n;

  -- T72 the deletion itself.
  perform admin_delete_clinic(clinic_d);
  select count(*) into n from public.clinics where id = clinic_d;
  raise notice '% T72 the clinic is gone -> % row', case when n = 0 then 'PASS:' else 'FAIL:' end, n;

  -- ⚠️ EVERY REMAINING ASSERTION MOVED TO db/tests/owner_tests.sql, and the
  -- reason is the point: they read public.users and public.clinic_deletions,
  -- which glowpt_app has NO grant on at all, by design. Asserted from here they
  -- do not fail loudly -- the suite simply stops, which is how this file can
  -- look like it passed while proving nothing. See the runner.
  -- Nothing to tidy: this is the last block in the last suite, and the admin's
  -- profile is exactly where the deletion left it, which T73b asserts.
  perform set_config('app.user_id', mgr_a::text, true);
end $$;
