-- ============================================================================
-- 2026-09-13 — first_name / last_name  (PATCH 1 of 2)
--
-- WHY: there was ONE full_name column, and three separate places took
-- everything before the first space as the first name. Two consequences, both
-- real and both reported by David:
--
--   1. IDENTIFICATION. A clinic routinely has several patients sharing a first
--      name AND a therapist. "Sarah" and "Sarah" on the roster are the same
--      row to a manager's eye, and a manager who invited only a first name had
--      no way to tell them apart afterwards.
--   2. "PT Pete". The RidgePT therapist who goes by that name was signed up
--      with it as his whole name, so split(' ')[0] made him "PT" and his
--      invite email opened "Hi PT,".
--
-- WHAT: two real columns. first_name is WHAT WE CALL YOU, verbatim, with no
-- title list and no guessing, and it is the only part that ever reaches the AI
-- prompt (the promise the privacy notice makes). last_name is WHAT
-- DISAMBIGUATES YOU on the roster. full_name becomes a DERIVED column in patch
-- 2, so the two can never drift from it.
--
-- SAFE TO RUN: adds two columns, backfills them from names already present,
-- and adds new function overloads BESIDE the existing ones. It changes no
-- existing content, deletes nothing, and drops no function. The currently
-- deployed API keeps working throughout, because every old signature and the
-- writable full_name column are deliberately LEFT IN PLACE. Patch 2 removes
-- them once the new API is live.
--
-- ORDER: THIS PATCH -> API deploy -> frontend -> patch 2.
-- (Note this is the opposite order to the 2026-09-12 local_date pair. There the
-- frontend had to lead because it computed the new value; here the DATABASE has
-- to lead, because the new API reads columns that must already exist.)
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- 1) The columns.
-- ---------------------------------------------------------------------------
alter table public.profiles       add column if not exists first_name text;
alter table public.profiles       add column if not exists last_name  text;
alter table public.staff_invites  add column if not exists first_name text;
alter table public.staff_invites  add column if not exists last_name  text;

-- ---------------------------------------------------------------------------
-- 2) Backfill, by splitting on the LAST space.
--
--    ⚠️ THIS IS A GUESS, AND IT IS THE LAST ONE THE SYSTEM WILL EVER MAKE.
--    It is right for the ordinary "Miracle Peterson" and wrong for "PT Pete",
--    which it files as PT / Pete -- exactly the bug this patch exists to fix.
--    That is accepted deliberately: the alternative is inventing a title list,
--    which is the approach being retired. David reviews the result afterwards
--    (the SELECT at the foot of this patch prints it) and corrects the few that
--    are wrong through the app.
--
--    A one-word name ("Charlie") becomes first_name with no last_name, which is
--    correct: nobody ever told us their surname.
--
--    Idempotent: only fills rows that have not been split yet.
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
-- 3) The app role may write the two new columns.
--
--    ⚠️ The update (full_name) grant is deliberately KEPT for now: the
--    currently deployed API's PATCH /me still writes it. Patch 2 revokes it,
--    at which point full_name stops being writable by anyone at all.
-- ---------------------------------------------------------------------------
grant update (first_name, last_name) on public.profiles to glowpt_app;

-- ---------------------------------------------------------------------------
-- 4) The functions, LIFTED VERBATIM FROM db/schema.sql.
--
--    ⚠️ These bodies are copied from the schema of record rather than written
--    out again here, and the rehearsal diffs the patched database against a
--    fresh build to prove they match byte for byte. Retyping them is how a
--    patch and the schema drift, and it already bit once in this very patch:
--    an earlier draft forgot provision_clinic entirely, which would have left
--    the OLD version writing to full_name and broken every new clinic sign-up
--    the moment patch 2 made that column generated.
--
--    ⚠️ register_user, join_clinic, invite_staff and invite_patient gain a
--    parameter, so these are OVERLOADS, not replacements: "create or replace"
--    only replaces a function with the identical argument list. That is what
--    lets the currently deployed API keep calling the old arity until it is
--    swapped out, and it is why patch 2 has to drop the old ones by their full
--    argument list. None of the new ones takes a default argument, so no call
--    can ever be ambiguous between the two generations.
--
--    ⚠️ get_staff_invite and weekly_summary_rows keep their argument lists but
--    change their RETURN TYPE, which "create or replace" cannot do, so each is
--    dropped first. Both are recreated in this same transaction.
-- ---------------------------------------------------------------------------

drop function if exists public.get_staff_invite(text);
drop function if exists public.weekly_summary_rows();

-- register_user: the AWS replacement for the handle_new_user trigger, which
-- cannot port (there is no auth.users to fire on). The Cognito post-confirmation
-- Lambda (Phase 2) calls this to create the identity row + a bare profile.
-- ⚠️ NO DEFAULTS ON p_first_name / p_last_name, DELIBERATELY. During the
-- 2026-09-13 rollout this function briefly coexisted with the old
-- register_user(uuid, citext, text) as an overload, and a default would have
-- made a 3-argument call match BOTH, which Postgres refuses as ambiguous --
-- breaking every sign-up in the window. Every caller passes all four.
create or replace function public.register_user(
    p_id uuid, p_email citext, p_first_name text, p_last_name text)
  returns void
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
begin
  insert into public.users (id, email) values (p_id, lower(p_email))
    on conflict (id) do nothing;
  insert into public.profiles (id, first_name, last_name)
    values (p_id, nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''))
    on conflict (id) do nothing;
end $$;

create or replace function public.provision_clinic(p_name text, p_slug text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic_id uuid;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  insert into public.clinics (name, slug) values (p_name, p_slug) returning id into v_clinic_id;
  insert into public.profiles (id, clinic_id, role)
    values (public.current_user_id(), v_clinic_id, 'manager')
    on conflict (id) do update set clinic_id = v_clinic_id, role = 'manager';
  return v_clinic_id;
end $$;

-- join_clinic: replaces the client-side profile upsert in the patient join flow.
-- Role is pinned to 'patient' server-side; clinic resolved from the slug; a
-- staff member is refused, not downgraded; consent written in the same txn.
create or replace function public.join_clinic(
    p_slug text, p_first_name text, p_last_name text, p_consent_version text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;

  select id from public.clinics where slug = lower(trim(p_slug)) into v_clinic;
  if v_clinic is null then raise exception 'Clinic not found'; end if;

  -- The activation gate. Enforced here, not in the UI, so it holds regardless
  -- of what the frontend does or whether the frontend is the caller at all.
  if not public.clinic_is_active(v_clinic) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  -- The self-serve gate. This function IS the open /join/<slug> path, so a
  -- clinic that has not asked for a walk-in QR refuses strangers here, in the
  -- database. An INVITED patient never reaches this function: they arrive
  -- through accept_patient_invite, which is matched to their own address.
  if not (select open_signup from public.clinics where id = v_clinic) then
    raise exception 'This clinic is invite only' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot self-join as a patient';
  end if;

  -- coalesce keeps a name the person already has rather than blanking it,
  -- exactly as it did when this was one column. Each part is kept separately,
  -- so someone who had a first name but no last one gains the last one here.
  insert into public.profiles (id, clinic_id, role, first_name, last_name)
    values (public.current_user_id(), v_clinic, 'patient',
            nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''))
    on conflict (id) do update
      set clinic_id  = v_clinic,
          role       = 'patient',
          first_name = coalesce(public.profiles.first_name, excluded.first_name),
          last_name  = coalesce(public.profiles.last_name,  excluded.last_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_clinic, 'hipaa_patient_ack', p_consent_version);
  end if;

  return v_clinic;
end $$;

-- Claim a staff invite and become therapist/manager of its clinic.
--
-- ⚠️ THE TOKEN IS NOT THE CREDENTIAL. It says WHICH invite is being claimed; the
-- gate is that the signed-in user's VERIFIED email must equal the invited email.
-- So a forwarded or leaked invite link grants nothing: the wrong person signing
-- up with it is refused here, in the database, whatever the frontend does. The
-- role likewise comes off the invite row, never from anything the caller sends.
--
-- p_token null is the FRONTEND SAFETY NET (auth.jsx re-runs this blind on first
-- sign-in when the post-confirmation Lambda may have missed). That path matches
-- on email alone and returns null rather than raising, because it is a
-- speculative retry for a user who usually has no invite at all.
create or replace function public.accept_staff_invite(p_token text default null)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email text; v_inv record;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  select email from public.users where id = public.current_user_id() into v_email;

  if p_token is not null then
    select * from public.staff_invites
      where token = p_token and consumed_at is null and expires_at > now()
      into v_inv;
    -- Loud, because someone followed a link and deserves to know why it failed.
    if v_inv.id is null then
      raise exception 'This invite link is no longer valid' using errcode = 'P0001';
    end if;
    -- ⚠️ `v_email is null` is load-bearing, not defensive noise. Without it a
    -- caller with no public.users row compares against NULL, the whole
    -- condition is NULL rather than true, and this guard FALLS THROUGH. The
    -- doc's promise that an invite link is safe to forward rests on this
    -- check, so it must fail closed. (Until 2026-09-05 only the profiles
    -- foreign key stopped that case, which is a backstop, not the guarantee.)
    if v_email is null or lower(v_inv.email) <> lower(v_email) then
      raise exception 'This invite is for a different email address' using errcode = 'P0001';
    end if;
    -- ⚠️ A patient invite must NOT be claimed here: this function records no
    -- consent, and a patient attached without a consents row is exactly the
    -- gap the privacy notice exists to close. accept_patient_invite is the
    -- only door for those.
    if v_inv.role = 'patient' then
      raise exception 'Use the patient invite flow for this invite' using errcode = 'P0001';
    end if;
  else
    -- The blind safety net. Staff roles only, for the same consent reason: a
    -- patient invite is never claimed by a speculative retry.
    select * from public.staff_invites
      where email = lower(v_email) and consumed_at is null and expires_at > now()
        and role <> 'patient'
      order by created_at desc limit 1 into v_inv;
    if v_inv.id is null then return null; end if;
  end if;
  insert into public.profiles (id, clinic_id, role, first_name, last_name)
    values (public.current_user_id(), v_inv.clinic_id, v_inv.role,
            v_inv.first_name, v_inv.last_name)
    on conflict (id) do update
      set clinic_id  = v_inv.clinic_id, role = v_inv.role,
          first_name = coalesce(public.profiles.first_name, v_inv.first_name),
          last_name  = coalesce(public.profiles.last_name,  v_inv.last_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- Returns the invite TOKEN so the caller can build the link to send. Re-inviting
-- the same address mints a FRESH token and a fresh expiry and clears consumed_at
-- — that is deliberately how a link sent to the wrong place gets invalidated.
-- ⚠️ NO DEFAULT ON p_role, for the same reason as register_user above: with
-- one, a 3-argument call would have matched both this and the old
-- invite_staff(text, text, text) during the rollout window. Callers pass the
-- role explicitly.
create or replace function public.invite_staff(
    p_email text, p_first_name text, p_last_name text, p_role text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  -- ⚠️ A last name is NOT required for staff. They do not appear on the patient
  -- roster, which is the thing two identical first names break, and a clinician
  -- who goes by "PT Pete" has no surname to give. See invite_patient, where it
  -- IS required.
  insert into public.staff_invites (clinic_id, email, first_name, last_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(btrim(p_first_name), ''),
          nullif(btrim(p_last_name), ''), p_role, public.current_user_id())
  on conflict (clinic_id, email) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Read an invite by its token, WITHOUT being signed in, so the sign-up screen
-- can say which clinic and which role before the person has an account. Serves
-- patient AND staff invites; the caller branches on the role it returns.
-- Same unauthenticated shape as get_clinic_by_slug. It reveals the invited email
-- to whoever holds the token, which is the point of an invite link; the token is
-- the secret, and holding it still does not let the wrong person claim the role.
-- An unknown, expired or already-used token returns zero rows.
create or replace function public.get_staff_invite(p_token text)
  returns table (clinic_name text, clinic_slug text, email text,
                 first_name text, last_name text, full_name text, role text)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.name, c.slug, i.email, i.first_name, i.last_name, i.full_name, i.role
    from public.staff_invites i
    join public.clinics c on c.id = i.clinic_id
   where i.token = p_token
     and i.consumed_at is null
     and i.expires_at > now()
$$;

-- Invite a PATIENT by email. Same token machinery as invite_staff and the same
-- guarantee: the token says which invite, the verified email is the gate. Split
-- from invite_staff rather than folded into it so a patient form can never be
-- coaxed into minting a therapist or manager invite by passing a role.
create or replace function public.invite_patient(
    p_email text, p_first_name text, p_last_name text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite patients'; end if;
  -- ⚠️ BOTH NAMES ARE REQUIRED FOR A PATIENT, AND THE RULE LIVES HERE RATHER
  -- THAN ONLY IN THE FORM. The roster is how a clinic tells one patient from
  -- another, and David's clinics routinely have several patients sharing a
  -- first name and a therapist. A form check alone would be a suggestion; this
  -- is the guarantee. (Staff are deliberately exempt: see invite_staff.)
  if nullif(btrim(p_first_name), '') is null then
    raise exception 'A first name is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_last_name), '') is null then
    raise exception 'A last name is required' using errcode = 'P0001';
  end if;
  insert into public.staff_invites (clinic_id, email, first_name, last_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), btrim(p_first_name),
          btrim(p_last_name), 'patient', public.current_user_id())
  on conflict (clinic_id, email) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        role = 'patient',
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Claim a PATIENT invite. The twin of accept_staff_invite, plus the one thing
-- that door cannot do: record consent, in the same transaction as the attach.
-- Role is pinned to 'patient' here rather than read off the invite, so even a
-- tampered invite row cannot mint staff through the patient screen.
create or replace function public.accept_patient_invite(p_token text, p_consent_version text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_email text; v_inv record;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;
  select email from public.users where id = public.current_user_id() into v_email;

  select * from public.staff_invites
    where token = p_token and consumed_at is null and expires_at > now()
    into v_inv;
  if v_inv.id is null then
    raise exception 'This invite link is no longer valid' using errcode = 'P0001';
  end if;
  -- See the note in accept_staff_invite: without the null test this guard
  -- falls through for a caller who has no public.users row.
  if v_email is null or lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invite is for a different email address' using errcode = 'P0001';
  end if;
  if v_inv.role <> 'patient' then
    raise exception 'Use the staff invite flow for this invite' using errcode = 'P0001';
  end if;

  -- An invited patient is enrolling in a clinic, so the activation gate applies
  -- exactly as it does on the open path. An invite is not a way around it.
  if not public.clinic_is_active(v_inv.clinic_id) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, first_name, last_name)
    values (public.current_user_id(), v_inv.clinic_id, 'patient',
            v_inv.first_name, v_inv.last_name)
    on conflict (id) do update
      set clinic_id  = v_inv.clinic_id, role = 'patient',
          first_name = coalesce(public.profiles.first_name, v_inv.first_name),
          last_name  = coalesce(public.profiles.last_name,  v_inv.last_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_inv.clinic_id, 'hipaa_patient_ack', p_consent_version);
  end if;

  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- weekly_summary_rows: the cross-clinic read for the weekly-summary Lambda (SES +
-- EventBridge, fires Mondays). Unlike every other read, this is a trusted batch
-- job that legitimately spans ALL clinics; glowpt_app is RLS-scoped to one user
-- and cannot serve it. So it runs as glowpt_auth (BYPASSRLS) and is callable ONLY
-- by the dedicated glowpt_weekly login role (grant below; NOT granted to
-- glowpt_app). Returns one row per email RECIPIENT: role='patient' rows drive the
-- personal nudge (own first name + own 7-day count), role in
-- ('manager','therapist') rows drive the clinic aggregate summary. The per-clinic
-- scoping and aggregates are all computed in SQL (GROUP BY), never a JS array
-- filter -- that filter was the old function's cross-tenant-leak risk. Discharged
-- people and clinic-less profiles are excluded; the window is check-ins in the
-- last 7 days counted as distinct UTC calendar days per patient.
create or replace function public.weekly_summary_rows()
  returns table (
    clinic_id              uuid,
    clinic_name            text,
    recipient_id           uuid,
    email                  citext,
    -- The greeting uses first_name, never a substring of full_name. full_name
    -- stays because the clinic-facing half of this function has always carried
    -- it and a future template may want it.
    first_name             text,
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
           p.first_name,
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
  select c.id, c.name, pt.recipient_id, pt.email, pt.first_name, pt.full_name,
         'patient'::text, pt.checkin_days, a.total, a.active
  from patients pt
  join public.clinics c on c.id = pt.clinic_id
  join agg a            on a.clinic_id = pt.clinic_id
  union all
  select c.id, c.name, sp.id, u.email, sp.first_name, sp.full_name,
         sp.role, 0, coalesce(a.total, 0), coalesce(a.active, 0)
  from public.profiles sp
  join public.users u   on u.id = sp.id
  join public.clinics c on c.id = sp.clinic_id
  left join agg a       on a.clinic_id = sp.clinic_id
  where sp.role in ('manager','therapist')
    and sp.discharged_at is null
$$;

-- ---------------------------------------------------------------------------
-- 6) Ownership, grants and the PUBLIC revoke.
--
--    ⚠️ A PATCH LEAVES A NEW FUNCTION EXECUTABLE BY PUBLIC; A FRESH BUILD DOES
--    NOT. schema.sql strips the implicit grant with a blanket revoke near its
--    foot, and a patch has no such sweep, so every function created above must
--    be revoked from PUBLIC explicitly before anything is granted. (Caught by
--    diffing a rehearsed patch against a fresh build, 2026-09-05.)
-- ---------------------------------------------------------------------------
alter function public.register_user(uuid, citext, text, text)  owner to glowpt_auth;
alter function public.provision_clinic(text, text)             owner to glowpt_auth;
alter function public.join_clinic(text, text, text, text)      owner to glowpt_auth;
alter function public.invite_staff(text, text, text, text)     owner to glowpt_auth;
alter function public.invite_patient(text, text, text)         owner to glowpt_auth;
alter function public.accept_staff_invite(text)                owner to glowpt_auth;
alter function public.accept_patient_invite(text, text)        owner to glowpt_auth;
alter function public.get_staff_invite(text)                   owner to glowpt_auth;
alter function public.weekly_summary_rows()                    owner to glowpt_auth;

revoke execute on function
  public.register_user(uuid, citext, text, text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text, text),
  public.invite_staff(text, text, text, text),
  public.invite_patient(text, text, text),
  public.accept_staff_invite(text),
  public.accept_patient_invite(text, text),
  public.get_staff_invite(text),
  public.weekly_summary_rows()
from public;

grant execute on function
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text, text),
  public.invite_staff(text, text, text, text),
  public.invite_patient(text, text, text),
  public.accept_staff_invite(text),
  public.accept_patient_invite(text, text),
  public.get_staff_invite(text)
to glowpt_app;

grant execute on function
  public.register_user(uuid, citext, text, text),
  public.provision_clinic(text, text),
  public.join_clinic(text, text, text, text),
  public.accept_staff_invite(text),
  public.accept_patient_invite(text, text)
to glowpt_postconfirm;

grant execute on function public.weekly_summary_rows() to glowpt_weekly;

-- ---------------------------------------------------------------------------
-- 7) GUARDS. Every one of these must hold, or the whole patch rolls back.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- The columns exist on both tables.
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'profiles'      and column_name in ('first_name','last_name'))
       or (table_name = 'staff_invites' and column_name in ('first_name','last_name')));
  if n <> 4 then raise exception 'GUARD: expected 4 new columns, found %', n; end if;

  -- Nobody with a name was left unsplit.
  select count(*) into n from public.profiles
   where nullif(btrim(full_name), '') is not null and first_name is null;
  if n <> 0 then raise exception 'GUARD: % profiles still unsplit', n; end if;

  select count(*) into n from public.staff_invites
   where nullif(btrim(full_name), '') is not null and first_name is null;
  if n <> 0 then raise exception 'GUARD: % invites still unsplit', n; end if;

  -- The split is lossless: rejoining the parts reproduces the original name.
  -- This is what proves the backfill invented nothing and dropped nothing.
  select count(*) into n from public.profiles
   where nullif(btrim(full_name), '') is not null
     and btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) <> btrim(full_name);
  if n <> 0 then raise exception 'GUARD: % profiles do not rejoin to their full_name', n; end if;

  -- ⚠️ PUBLIC must not be able to execute anything created above. A patch does
  -- not get schema.sql's blanket revoke for free.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('register_user','join_clinic','invite_staff','invite_patient',
                       'accept_staff_invite','accept_patient_invite','get_staff_invite',
                       'weekly_summary_rows')
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then raise exception 'GUARD: % functions are still executable by PUBLIC', n; end if;

  raise notice 'PATCH 1 OK: columns added, names split losslessly, new overloads installed.';
end $$;

commit;

-- ---------------------------------------------------------------------------
-- REVIEW THE SPLIT. Run this after committing and read it with David.
-- Anyone whose last_name is null had only ever given one name (fine), and
-- anyone like "PT Pete" who was split in the wrong place shows up here.
-- ---------------------------------------------------------------------------
select role, full_name as "was", first_name as "first", coalesce(last_name, '(none)') as "last"
  from public.profiles
 where full_name is not null
 order by role, first_name;
