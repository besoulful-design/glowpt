-- Delete the "Weekly Test PT" seed clinic and its four people.
--
-- Riverside PT took over as the Monday heartbeat: it is kept fresh for demos,
-- so its weekly email is a more reliable signal than a clinic whose data had
-- aged into 0% engagement.
--
-- ⚠️ THE ORDER MATTERS. profiles.clinic_id is ON DELETE SET NULL, so deleting
-- the clinic on its own does NOT remove its people, it ORPHANS them: four
-- profiles left with clinic_id = null, which is the V2.4 orphan class. Delete
-- the users first (profiles/checkins/consents/access_log all cascade from
-- users), then the clinic row.
--
-- Wrapped in a transaction with a hard assertion. If it would leave a single
-- orphan, or touch Riverside, it raises and the whole thing rolls back.

begin;

\echo '--- BEFORE ---'
select c.name, c.slug,
       (select count(*) from profiles p where p.clinic_id = c.id) as people
from clinics c order by c.created_at;

-- The people first.
delete from users u
where u.id in (
  select p.id from profiles p
  join clinics c on c.id = p.clinic_id
  where c.slug = 'weekly-test'
);

-- Then the clinic.
delete from clinics where slug = 'weekly-test';

-- Hard guards. Any failure here aborts and rolls the whole thing back.
do $$
declare orphans int; leftover int; riverside int;
begin
  select count(*) into orphans  from profiles where clinic_id is null;
  select count(*) into leftover from clinics  where slug = 'weekly-test';
  select count(*) into riverside from profiles p join clinics c on c.id = p.clinic_id
    where c.slug = 'riverside-pt';

  if orphans > 0 then
    raise exception 'ABORT: % orphaned profile(s) would be left behind', orphans;
  end if;
  if leftover > 0 then
    raise exception 'ABORT: weekly-test clinic still present';
  end if;
  if riverside <> 8 then
    raise exception 'ABORT: Riverside should have 8 people, found %', riverside;
  end if;

  raise notice 'guards passed: 0 orphans, weekly-test gone, Riverside intact at 8';
end $$;

\echo '--- AFTER ---'
select c.name, c.slug,
       (select count(*) from profiles p where p.clinic_id = c.id) as people
from clinics c order by c.created_at;
select count(*) as orphans_must_be_zero from profiles where clinic_id is null;

commit;
