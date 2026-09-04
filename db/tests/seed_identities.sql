-- GlowPT: identity seed. Run as role glowpt_postconfirm (the Cognito
-- post-confirmation Lambda's own role). This IS that Lambda's register_user
-- step: minting the six users + bare profiles the RLS attack tests build on.
--
-- Running successfully as glowpt_postconfirm is itself the proof that the
-- dedicated role CAN create identities. rls_tests.sql then proves glowpt_app
-- CANNOT (T15). T16 below proves glowpt_postconfirm also holds EXECUTE on the
-- three attach RPCs it dispatches to.
\set QUIET on
set client_min_messages = notice;

select register_user('11111111-1111-1111-1111-111111111111','mgra@a.com','Mgr A');
select register_user('22222222-2222-2222-2222-222222222222','pata1@a.com','Pat A1');
select register_user('33333333-3333-3333-3333-333333333333','pata2@a.com','Pat A2');
select register_user('44444444-4444-4444-4444-444444444444','thera@a.com','Ther A');
select register_user('55555555-5555-5555-5555-555555555555','mgrb@b.com','Mgr B');
select register_user('66666666-6666-6666-6666-666666666666','patb1@b.com','Pat B1');
-- Platform-admin + a third clinic used only for the activation-gate tests.
select register_user('77777777-7777-7777-7777-777777777777','admin@glowpt.app','Platform Admin');
select register_user('88888888-8888-8888-8888-888888888888','mgrc@c.com','Mgr C');
select register_user('99999999-9999-9999-9999-999999999999','patc1@c.com','Pat C1');
-- Staff-invite-link identities (invite_tests.sql): the properly invited person,
-- someone who merely holds the link, and the target of an expired invite.
select register_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','newstaff@a.com','New Staff');
select register_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','wrongperson@a.com','Wrong Person');
select register_user('cccccccc-cccc-cccc-cccc-cccccccccccc','expired@a.com','Expired Invitee');
select register_user('dddddddd-dddd-dddd-dddd-dddddddddddd','newpat@a.com','New Patient');

\set QUIET off
do $$
declare ok boolean;
begin
  -- T16 GRANTS: glowpt_postconfirm can execute the three attach RPCs it will
  -- dispatch to after register_user (join / onboard / staff paths).
  ok := has_function_privilege('glowpt_postconfirm','public.join_clinic(text,text,text)','execute')
    and has_function_privilege('glowpt_postconfirm','public.provision_clinic(text,text)','execute')
    and has_function_privilege('glowpt_postconfirm','public.accept_staff_invite(text)','execute');
  raise notice '% T16 postconfirm can execute the three attach RPCs', case when ok then 'PASS:' else 'FAIL:' end;
end $$;
