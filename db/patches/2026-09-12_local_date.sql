-- ============================================================================
-- 2026-09-12 — checkins.local_date  (PATCH 1 of 2)
--
-- WHY: the day a check-in belonged to was derived from created_at in UTC, while
-- every screen bucketed by the reader's LOCAL day. In Eastern the UTC day rolls
-- over at 8pm, so a check-in made after 8pm was filed under the NEXT UTC day --
-- and the next morning's check-in landed in that same slot and OVERWROTE it.
-- One row, not two: the evening's feeling, note and reflection replaced, the
-- original created_at left in place (it is not in the upsert's update list), and
-- the streak reading a day short. Charlie lost his Friday 2026-09-11 20:14
-- entry to Saturday morning's check-in exactly this way.
--
-- WHAT: add the patient's own calendar day to the row and make THAT the day key.
--
-- SAFE TO RUN: adds a column and an index, changes no existing content, deletes
-- nothing. The OLD unique index is deliberately LEFT IN PLACE by this patch so
-- the currently-deployed API (which conflicts on utc_date(created_at)) keeps
-- working while the new API rolls out. Patch 2 drops it.
--
-- ORDER: frontend -> THIS PATCH -> API deploy -> patch 2.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- 1) The column. Nullable for now so the backfill can run.
alter table public.checkins add column if not exists local_date date;

-- 2) Backfill. Every check-in in the system to date was made in US Eastern
--    (Philadelphia: David, his family and the seeded Riverside demo), so the
--    patient's own calendar day IS the Eastern date of created_at.
--    ⚠️ America/New_York is correct for the ROWS THAT ALREADY EXIST. It is not a
--    rule going forward -- new rows carry the date their own device reported.
update public.checkins
   set local_date = (created_at at time zone 'America/New_York')::date
 where local_date is null;

-- 3) Repair the rows whose content was already overwritten.
--    An after-8pm row can collide with an earlier check-in from the same local
--    day. When it does, the LATER-created row is the evening one -- and the
--    content sitting in it is not the evening's at all: it was written by the
--    next morning's check-in, which found the slot taken and updated it. So its
--    surviving content belongs to the UTC day it was filed under, which is the
--    morning it actually came from.
--    This both preserves what is really there and clears the duplicate that
--    would otherwise stop the new unique index from building.
--    (Today this repairs exactly one row: Charlie, 2026-09-11 20:14 local,
--    carrying Saturday morning's "I got up at 3am".)
update public.checkins c
   set local_date = public.utc_date(c.created_at)
 where exists (
   select 1 from public.checkins o
    where o.user_id    = c.user_id
      and o.local_date = c.local_date
      and o.id        <> c.id
      and o.created_at < c.created_at
 );

-- 4) Lock it down. The default reproduces the OLD behaviour exactly and exists
--    ONLY for the window between this patch and the new API: the deployed API
--    still inserts without local_date, and a NOT NULL column with no default
--    would refuse every check-in in the meantime. Patch 2 drops the default.
alter table public.checkins alter column local_date set default public.utc_date(now());
alter table public.checkins alter column local_date set not null;

-- 5) The new day key. Created alongside the old index, not instead of it.
create unique index if not exists checkins_one_per_local_day
  on public.checkins (user_id, local_date);

-- ---------------------------------------------------------------------------
-- Guards. Anything unexpected rolls the whole patch back.
-- ---------------------------------------------------------------------------
do $$
declare
  n_null  integer;
  n_dup   integer;
  n_moved integer;
begin
  select count(*) into n_null from public.checkins where local_date is null;
  if n_null <> 0 then
    raise exception 'GUARD FAILED: % check-in(s) still have no local_date', n_null;
  end if;

  select count(*) into n_dup from (
    select user_id, local_date from public.checkins
    group by 1,2 having count(*) > 1
  ) d;
  if n_dup <> 0 then
    raise exception 'GUARD FAILED: % patient/day pair(s) still duplicated', n_dup;
  end if;

  if to_regclass('public.checkins_one_per_day') is null then
    raise exception 'GUARD FAILED: the old index was dropped -- patch 2 does that, not this one';
  end if;

  select count(*) into n_moved from public.checkins
   where local_date <> (created_at at time zone 'America/New_York')::date;

  raise notice 'GUARDS PASSED: % check-in(s) carry a local_date; % repaired from an overwrite', 
    (select count(*) from public.checkins), n_moved;
end $$;

commit;
