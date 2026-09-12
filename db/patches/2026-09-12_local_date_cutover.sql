-- ============================================================================
-- 2026-09-12 — checkins.local_date  (PATCH 2 of 2, the cutover)
--
-- RUN THIS ONLY AFTER the new API is deployed and verified. Patch 1 left the
-- old UTC-day unique index in place so the previously-deployed API kept
-- working; this drops it, which is the moment the bug actually stops.
--
-- WHY IT IS SEPARATE: the deployed API names its conflict target explicitly
-- (`on conflict (user_id, ...)`). Dropping the index the OLD API names would
-- make every check-in fail until the new API landed. Splitting it means there
-- is no window in which a patient cannot check in.
--
-- WHAT IT LEAVES: checkins_one_per_local_day is renamed to checkins_one_per_day
-- so the live database matches db/schema.sql, which is the schema of record.
--
-- SAFE TO RUN: drops an index and a column default. No content changes, nothing
-- deleted. Re-runnable.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- 1) The new index must already be carrying the constraint before the old one
--    goes, or this patch is the outage it exists to prevent.
do $$
begin
  if to_regclass('public.checkins_one_per_local_day') is null
     and to_regclass('public.checkins_one_per_day') is null then
    raise exception 'GUARD FAILED: no local-day unique index present -- run patch 1 first';
  end if;
end $$;

-- 2) Drop the old UTC-day key.
--    ⚠️ BY DEFINITION, NOT BY NAME, and that is not fussiness. Step 3 renames the
--    new index INTO the old one's name, so a second run of a name-based
--    `drop index if exists public.checkins_one_per_day` would delete the index
--    this patch had just installed and leave the table with no day key at all.
--    Matching on utc_date drops only the genuinely old one, and finds nothing on
--    a re-run.
do $$
declare r record;
begin
  for r in
    select i.indexrelid::regclass::text as idx
      from pg_index i
     where i.indrelid = 'public.checkins'::regclass
       and i.indisunique
       and pg_get_indexdef(i.indexrelid) like '%utc_date%'
  loop
    raise notice 'dropping old UTC-day index: %', r.idx;
    execute format('drop index %s', r.idx);
  end loop;
end $$;

-- 3) Take its name, so the live schema matches db/schema.sql. Skipped on a
--    re-run, when the source index no longer exists under that name.
alter index if exists public.checkins_one_per_local_day
  rename to checkins_one_per_day;

-- 4) The weekly email must count the patient's own days too.
--    ⚠️ NOT COSMETIC: weekly_summary_rows() counted distinct UTC days, the same
--    axis as the bug. A patient whose evening check-in spilled into the next UTC
--    date was counted twice -- on 2026-09-12 Charlie's two Friday check-ins read
--    as 3 days instead of 2. The body below is spliced verbatim from
--    db/schema.sql so the two cannot drift.
--    ⏰ THIS MUST BE APPLIED BEFORE THE SUNDAY 18:00 EDT SEND.
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
           -- Distinct days the PATIENT was living in, not distinct UTC days.
           -- Counting UTC days double-counted anyone whose evening check-in
           -- spilled into the next UTC date: on 2026-09-12 Charlie's two Friday
           -- check-ins read as 3 days instead of 2.
           count(distinct ch.local_date)::int as days
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
  select c.id, c.name, pt.recipient_id, pt.email, pt.full_name,
         'patient'::text, pt.checkin_days, a.total, a.active
  from patients pt
  join public.clinics c on c.id = pt.clinic_id
  join agg a            on a.clinic_id = pt.clinic_id
  union all
  select c.id, c.name, sp.id, u.email, sp.full_name,
         sp.role, 0, coalesce(a.total, 0), coalesce(a.active, 0)
  from public.profiles sp
  join public.users u   on u.id = sp.id
  join public.clinics c on c.id = sp.clinic_id
  left join agg a       on a.clinic_id = sp.clinic_id
  where sp.role in ('manager','therapist')
    and sp.discharged_at is null
$$;

-- create-or-replace keeps existing grants, but the owner must be re-asserted:
-- the definer read has to run as glowpt_auth (BYPASSRLS) to see every clinic.
alter function public.weekly_summary_rows() owner to glowpt_auth;
revoke execute on function public.weekly_summary_rows() from public;
grant execute on function public.weekly_summary_rows() to glowpt_weekly;

-- 5) Drop the transitional default. From here every writer must state the day
--    it means. A writer that forgets now fails loudly instead of silently
--    filing a check-in under a UTC day again -- which is the whole bug.
alter table public.checkins alter column local_date drop default;

-- ---------------------------------------------------------------------------
-- Guards.
-- ---------------------------------------------------------------------------
do $$
declare
  idx_def text;
  has_def boolean;
begin
  select pg_get_indexdef(i.indexrelid) into idx_def
    from pg_index i
   where i.indrelid = 'public.checkins'::regclass
     and i.indisunique
     and pg_get_indexdef(i.indexrelid) like '%local_date%';

  if idx_def is null then
    raise exception 'GUARD FAILED: no unique index on local_date survived';
  end if;
  if idx_def like '%utc_date%' then
    raise exception 'GUARD FAILED: a UTC-day unique index is still present: %', idx_def;
  end if;

  select count(*) > 0 into has_def
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.checkins'::regclass and a.attname = 'local_date';
  if has_def then
    raise exception 'GUARD FAILED: local_date still carries a default';
  end if;

  raise notice 'GUARDS PASSED: day key is now %', idx_def;
end $$;

commit;
