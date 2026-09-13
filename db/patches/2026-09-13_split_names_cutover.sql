-- ============================================================================
-- 2026-09-13 — first_name / last_name  (PATCH 2 of 2)
--
-- RUN THIS ONLY AFTER the new API Lambda AND the new frontend are live.
-- Patch 1 -> API deploy -> frontend -> THIS.
--
-- WHAT IT DOES: retires the old single-name world.
--   1. Splits anything that arrived through an OLD code path during the rollout
--      window (a sign-up mid-flight when the Lambda was replaced).
--   2. Drops the four old function signatures, which nothing calls any more.
--   3. Makes full_name a STORED GENERATED column, so first_name and last_name
--      become the only writable name fields and cannot drift from it.
--   4. Revokes the now-meaningless update (full_name) grant.
--
-- ⚠️ RE-RUNNABLE. Step 3 is guarded on full_name not already being generated,
-- because a second run would otherwise drop the real names and rebuild the
-- column empty. (This is the trap the 2026-09-12 patch 2 had, where a
-- name-based drop would have deleted the index it had just installed.)
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- 1) Catch anything the rollout window created with a full_name and no parts.
--    Same last-space rule as patch 1. Usually zero rows.
-- ---------------------------------------------------------------------------
update public.profiles
   set first_name = case when btrim(full_name) like '% %'
                         then btrim(left(btrim(full_name), length(btrim(full_name)) - strpos(reverse(btrim(full_name)), ' ')))
                         else btrim(full_name) end,
       last_name  = case when btrim(full_name) like '% %'
                         then btrim(right(btrim(full_name), strpos(reverse(btrim(full_name)), ' ') - 1))
                         else null end
 where first_name is null
   and nullif(btrim(full_name), '') is not null;

update public.staff_invites
   set first_name = case when btrim(full_name) like '% %'
                         then btrim(left(btrim(full_name), length(btrim(full_name)) - strpos(reverse(btrim(full_name)), ' ')))
                         else btrim(full_name) end,
       last_name  = case when btrim(full_name) like '% %'
                         then btrim(right(btrim(full_name), strpos(reverse(btrim(full_name)), ' ') - 1))
                         else null end
 where first_name is null
   and nullif(btrim(full_name), '') is not null;

-- ---------------------------------------------------------------------------
-- 2) Drop the old signatures. Named by their FULL argument list, because the
--    new ones differ only in arity and sit in the same name.
-- ---------------------------------------------------------------------------
drop function if exists public.register_user(uuid, citext, text);
drop function if exists public.join_clinic(text, text, text);
drop function if exists public.invite_staff(text, text, text);
drop function if exists public.invite_patient(text, text);

-- ---------------------------------------------------------------------------
-- 3) full_name becomes derived.
--
--    A generated column cannot be added in place, so the old one is dropped and
--    replaced. That is safe here only because every row's name now lives in
--    first_name/last_name (step 1 above, guarded at the foot), and it is the
--    reason step 1 must run first.
--
--    ⚠️ THE GUARD IS WHAT MAKES THIS RE-RUNNABLE. On a second run full_name is
--    already generated, so there is nothing to preserve and nothing to do --
--    without the check, the drop would take the derived column and rebuild it
--    from parts that are still there, which happens to be harmless here but is
--    the exact shape of a migration that eats its own work.
-- ---------------------------------------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','staff_invites'] loop
    if not exists (
      select 1 from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = tbl
         and a.attname = 'full_name' and a.attgenerated <> ''
    ) then
      execute format('alter table public.%I drop column full_name', tbl);
      execute format($f$
        alter table public.%I add column full_name text
          generated always as (nullif(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '')) stored
      $f$, tbl);
      raise notice 'full_name on public.% is now generated', tbl;
    else
      raise notice 'full_name on public.% was already generated, left alone', tbl;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) full_name is no longer writable by anyone, so the grant is meaningless.
--    (revoke on a generated column is accepted and is the honest record of
--    intent; the column-level privilege simply no longer applies.)
-- ---------------------------------------------------------------------------
revoke update (full_name) on public.profiles from glowpt_app;

-- ---------------------------------------------------------------------------
-- 5) GUARDS.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- Both full_name columns are generated.
  select count(*) into n from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname in ('profiles','staff_invites')
     and a.attname = 'full_name' and a.attgenerated <> '';
  if n <> 2 then raise exception 'GUARD: expected 2 generated full_name columns, found %', n; end if;

  -- No name was lost in the rebuild.
  select count(*) into n from public.profiles
   where first_name is not null and full_name is null;
  if n <> 0 then raise exception 'GUARD: % profiles have a first name but no composed full_name', n; end if;

  -- The old signatures are gone, so nothing can quietly keep calling them.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and (
       (p.proname = 'register_user'  and pg_get_function_identity_arguments(p.oid) = 'uuid, citext, text') or
       (p.proname = 'join_clinic'    and pg_get_function_identity_arguments(p.oid) = 'text, text, text') or
       (p.proname = 'invite_staff'   and pg_get_function_identity_arguments(p.oid) = 'text, text, text') or
       (p.proname = 'invite_patient' and pg_get_function_identity_arguments(p.oid) = 'text, text')
     );
  if n <> 0 then raise exception 'GUARD: % old function signatures survive', n; end if;

  raise notice 'PATCH 2 OK: full_name is derived, old signatures dropped.';
end $$;

commit;
