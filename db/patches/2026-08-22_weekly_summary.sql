-- ============================================================================
-- GlowPT AWS patch: weekly-summary data function + its dedicated login role.
-- ============================================================================
-- Adds everything the weekly-summary Lambda (SES + EventBridge, fires Mondays)
-- needs on the DB side to the ALREADY-LOADED RDS `glowpt` database. db/schema.sql
-- is the schema-of-record for a FRESH load and carries the same objects; this
-- forward patch delivers them to the live database (schema.sql is not re-runnable),
-- same pattern as 2026-08-18_postconfirm_role.sql.
--
-- What it adds:
--   * public.weekly_summary_rows()  -- one row per email RECIPIENT, ALL clinics,
--       with the per-clinic scoping done IN SQL (never a JS array filter -- the
--       old code's cross-tenant-leak risk). Owned by glowpt_auth (BYPASSRLS),
--       SECURITY DEFINER, row_security off: the same trusted-read pattern as the
--       other definer functions, because a weekly batch job legitimately reads
--       every clinic and glowpt_app (RLS-scoped to one user) cannot.
--   * glowpt_auth gets SELECT on public.checkins. Its other functions never read
--       check-ins, so that grant did not exist yet; the summary function needs it.
--   * role glowpt_weekly: LOGIN, NO table grants, EXECUTE on ONLY this one
--       function. Deliberately NOT granted to glowpt_app (that would expose every
--       clinic's data to any patient). Password set out of band to match the
--       glowpt/db/weekly secret (see the deploy runbook), same as app/postconfirm.
--
-- Safe to run against the loaded RDS. Idempotent: re-running is a no-op.
-- Run as glowpt_admin (a member of rds_superuser) over the bastion tunnel.
-- No secrets here.
--
-- NOTE (migration standing rule): no em dashes anywhere in this file.
-- ============================================================================

-- 1. The internal definer role needs to read check-ins to count them. It already
--    has select on users/clinics/profiles; checkins was never needed until now.
grant select on public.checkins to glowpt_auth;

-- 2. The cross-clinic summary read. One row per RECIPIENT:
--      * role = 'patient'                 -> gets the personal nudge (own first
--                                            name + own 7-day count + a link)
--      * role in ('manager','therapist')  -> gets the clinic aggregate summary
--    Every row carries its own clinic_id / clinic_name straight from the join,
--    and the per-clinic aggregates (total patients, active patients) are computed
--    in SQL with GROUP BY, so the Lambda never mixes clinics. Discharged people
--    and clinic-less profiles are excluded. The window is check-ins in the last
--    7 days, counted as DISTINCT UTC calendar days per patient (the app's model).
create or replace function public.weekly_summary_rows()
  returns table (
    clinic_id              uuid,
    clinic_name            text,
    recipient_id           uuid,
    email                  citext,
    full_name              text,
    role                   text,
    checkin_days           integer,
    clinic_total_patients  integer,
    clinic_active_patients integer
  )
  language sql stable security definer
  set search_path = public
  set row_security = off
as $$
  with recent as (
    select ch.user_id,
           -- distinct UTC calendar days; same rule as public.utc_date(), inlined
           -- to keep this function free of any create-order / grant dependency.
           count(distinct (ch.created_at at time zone 'UTC')::date)::int as days
    from public.checkins ch
    where ch.created_at >= now() - interval '7 days'
    group by ch.user_id
  ),
  patients as (
    select p.clinic_id,
           p.id                as recipient_id,
           u.email,
           p.full_name,
           coalesce(r.days, 0) as checkin_days
    from public.profiles p
    join public.users u on u.id = p.id
    left join recent r  on r.user_id = p.id
    where p.role = 'patient'
      and p.discharged_at is null
      and p.clinic_id is not null
  ),
  agg as (
    select clinic_id,
           count(*)::int                                 as total,
           count(*) filter (where checkin_days > 0)::int as active
    from patients
    group by clinic_id
  )
  -- one row per PATIENT recipient
  select c.id, c.name, pt.recipient_id, pt.email, pt.full_name,
         'patient'::text, pt.checkin_days, a.total, a.active
  from patients pt
  join public.clinics c on c.id = pt.clinic_id
  join agg a            on a.clinic_id = pt.clinic_id
  union all
  -- one row per STAFF recipient (manager / therapist)
  select c.id, c.name, sp.id, u.email, sp.full_name,
         sp.role, 0, coalesce(a.total, 0), coalesce(a.active, 0)
  from public.profiles sp
  join public.users u   on u.id = sp.id
  join public.clinics c on c.id = sp.clinic_id
  left join agg a       on a.clinic_id = sp.clinic_id
  where sp.role in ('manager','therapist')
    and sp.discharged_at is null
$$;

-- 3. Pin the owner to glowpt_auth (BYPASSRLS) so the definer read does not
--    recurse under FORCE RLS, same as every other definer function.
alter function public.weekly_summary_rows() owner to glowpt_auth;

-- 4. CRITICAL: a freshly created function grants EXECUTE to PUBLIC by default.
--    Revoke that, or glowpt_app (which is a member of PUBLIC) could read every
--    clinic -- the exact cross-tenant hole this whole design avoids.
revoke execute on function public.weekly_summary_rows() from public;

-- 5. The dedicated login role for the weekly Lambda. No table grants at all; it
--    can do exactly one thing: call weekly_summary_rows(). Password set out of
--    band to match the glowpt/db/weekly secret (see the deploy runbook).
do $$
begin
  if not exists (select from pg_roles where rolname = 'glowpt_weekly') then
    create role glowpt_weekly login;
  end if;
end $$;

grant usage   on schema public to glowpt_weekly;
grant execute on function public.weekly_summary_rows() to glowpt_weekly;

-- 6. Verify. Expected: all three checks return true.
select 'weekly CAN call weekly_summary_rows' as check,
       has_function_privilege('glowpt_weekly',
         'public.weekly_summary_rows()', 'execute') as ok
union all
select 'app CANNOT call weekly_summary_rows',
       not has_function_privilege('glowpt_app',
         'public.weekly_summary_rows()', 'execute')
union all
select 'auth CAN read checkins',
       has_table_privilege('glowpt_auth', 'public.checkins', 'select');
