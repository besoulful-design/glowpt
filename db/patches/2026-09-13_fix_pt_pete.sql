-- ============================================================================
-- 2026-09-13 — restore "PT Pete" as ONE first name.
--
-- RUN AFTER the two split_names patches.
--
-- WHY: the backfill in patch 1 split every existing name on its last space.
-- That was right for 16 of the 17 people in the system and wrong for exactly
-- one: the RidgePT therapist who goes by "PT Pete" became first "PT", last
-- "Pete". That is the very bug the two-field change exists to end, and the
-- backfill reproduced it because a last-space split is still a guess. It is the
-- LAST guess the system makes; from here a name is whatever was typed.
--
-- David's call (2026-09-13): first_name "PT Pete", no last name. A therapist is
-- not on the patient roster, which is the thing two identical first names
-- break, so no surname is needed. His full_name is unchanged either way, since
-- it composes back to "PT Pete"; what this fixes is his own dashboard greeting,
-- which read "Welcome back, PT".
--
-- SAFE TO RUN: touches one row, matched on both parts so it cannot hit anyone
-- else, and re-running it is a no-op once the row no longer matches.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

update public.profiles
   set first_name = 'PT Pete', last_name = null
 where first_name = 'PT' and last_name = 'Pete';

-- Any invite row carrying the same wrong split (a pending re-invite would still
-- be showing "PT / Pete" on the dashboard's Invited list).
update public.staff_invites
   set first_name = 'PT Pete', last_name = null
 where first_name = 'PT' and last_name = 'Pete';

do $$
declare n int;
begin
  select count(*) into n from public.profiles
   where first_name = 'PT Pete' and last_name is null;
  if n <> 1 then raise exception 'GUARD: expected exactly 1 "PT Pete" profile, found %', n; end if;

  -- Nobody else was touched: the composed name must still read "PT Pete".
  select count(*) into n from public.profiles where full_name = 'PT Pete';
  if n <> 1 then raise exception 'GUARD: full_name no longer composes to "PT Pete" (% rows)', n; end if;

  raise notice 'OK: PT Pete is one first name again.';
end $$;

commit;

select first_name as "first", coalesce(last_name, '(none)') as "last",
       full_name as "composed", role
  from public.profiles
 where first_name = 'PT Pete';
