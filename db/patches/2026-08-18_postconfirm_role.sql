-- ============================================================================
-- GlowPT AWS patch: add the glowpt_postconfirm role to an ALREADY-LOADED RDS.
-- ============================================================================
-- db/schema.sql is the schema-of-record and is applied ONCE to a fresh database
-- (its CREATE TABLEs are not re-runnable). The RDS `glowpt` database was already
-- loaded 2026-08-10, so the Phase 2.1 change (the dedicated post-confirmation
-- role) is delivered as this forward patch instead.
--
-- Safe to run against the loaded RDS. Idempotent: re-running is a no-op.
-- Run as glowpt_admin (a member of rds_superuser) over the bastion tunnel.
-- No secrets here; the role's password is set separately (see the runbook).
--
-- NOTE (migration standing rule): no em dashes anywhere in this file.
-- ============================================================================

-- 1. The role: LOGIN, no bypass, owns nothing. Password set out of band.
do $$
begin
  if not exists (select from pg_roles where rolname = 'glowpt_postconfirm') then
    create role glowpt_postconfirm login;
  end if;
end $$;

-- 2. It must resolve objects in schema public.
grant usage on schema public to glowpt_postconfirm;

-- 3. EXECUTE on ONLY the four sign-up functions, nothing else.
grant execute on function
  public.register_user(uuid, citext, text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text),
  public.accept_staff_invite()
to glowpt_postconfirm;

-- 4. Take identity creation away from the general app role. This is the one
--    line that changes existing state: on RDS, glowpt_app was granted
--    register_user when the schema first loaded. After this, only
--    glowpt_postconfirm can mint identities.
revoke execute on function public.register_user(uuid, citext, text) from glowpt_app;

-- 5. Verify (prints two rows: postconfirm should have execute, app should not).
select 'postconfirm can register_user' as check,
       has_function_privilege('glowpt_postconfirm',
         'public.register_user(uuid, citext, text)', 'execute') as ok
union all
select 'app CANNOT register_user',
       not has_function_privilege('glowpt_app',
         'public.register_user(uuid, citext, text)', 'execute');
