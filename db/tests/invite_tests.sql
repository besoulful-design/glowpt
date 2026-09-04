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
end $$;
