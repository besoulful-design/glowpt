-- 2026-09-05 — constrain checkins.feeling to the 1-5 scale.
--
-- WHY. src/lib/feelings.js maps 1-5 to a face and a word, and the clinic
-- dashboard indexes that map directly with Math.round(avg). A stored value off
-- the scale is therefore a lookup that returns undefined, and reading .word off
-- it throws while React is rendering. There is no error boundary, so the whole
-- tree unmounts: today one check-in stored with feeling = 0 gave every manager
-- and therapist in that clinic a blank page after sign-in.
--
-- HOW IT GOT IN. The API did `Number(b.feeling)`, which returns 0 for null, and
-- `Number.isInteger(0)` is true — so the guard written to reject a missing
-- rating passed it through as a valid-looking 0. That is fixed in the handler;
-- this is the backstop that holds regardless of what any client sends.
--
-- Idempotent, and it deletes nothing. The mood is now required in the app, so
-- there is no legitimate way to produce a row this would reject.

\set ON_ERROR_STOP on
begin;

-- Guard 1: refuse to run at all if any existing row would violate the check.
-- Adding the constraint would fail anyway; this fails with a message that says
-- what to fix instead of a bare constraint-violation error.
do $$
declare bad int;
begin
  select count(*) into bad from public.checkins where feeling is null or feeling < 1 or feeling > 5;
  if bad > 0 then
    raise exception 'ABORTING: % check-in row(s) are off the 1-5 scale. Fix or remove them first (a patient re-doing that day''s check-in overwrites the row, since check-ins are one per UTC day).', bad;
  end if;
end $$;

-- The constraint itself. Named, and declared the same way in db/schema.sql, so a
-- patched database and a fresh build produce the identical object.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'checkins_feeling_range'
       and conrelid = 'public.checkins'::regclass
  ) then
    alter table public.checkins
      add constraint checkins_feeling_range check (feeling between 1 and 5);
  end if;
end $$;

-- Guard 2: prove it is actually there and actually enforcing, before committing.
do $$
declare ok boolean;
begin
  select exists (
    select 1 from pg_constraint
     where conname = 'checkins_feeling_range'
       and conrelid = 'public.checkins'::regclass
       and convalidated
  ) into ok;
  if not ok then
    raise exception 'ABORTING: checkins_feeling_range is missing or not validated.';
  end if;
  raise notice 'GUARDS PASSED: checkins.feeling is constrained to 1-5 and validated.';
end $$;

commit;
