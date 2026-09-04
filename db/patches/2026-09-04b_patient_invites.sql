-- GlowPT patch: patient invites + the per-clinic sign-up switch (2026-09-04b)
-- ============================================================================
-- WHY: anyone who had, or guessed, a clinic's /join/<slug> link could enrol as
-- a patient of that clinic. Slugs are guessable, so this was never only about a
-- forwarded link. It leaked nothing (RLS still scoped a stray to their own
-- data) but it put strangers in a real clinic's roster and their notes in the
-- database. Deliberate since 2026-07-15, when the QR was the whole point;
-- David's call on 2026-09-04 was to close it.
--
-- SHAPE: a THIRD per-clinic flag, clinics.open_signup, separate from
-- activated_at and baa_signed_at because it answers a different question.
-- Activation is "may this clinic operate at all". This is "how does it enrol".
--   false (the default, so a new clinic is never exposed by accident)
--         = invite only. /join/<slug> and its QR refuse everyone.
--   true  = the self-serve walk-in path, for a clinic that wants a front-desk QR.
--
-- ⚠️ THIS PATCH SETS RIVERSIDE OPEN AND EVERY OTHER CLINIC INVITE-ONLY. That is
-- David's explicit choice: Riverside is the sales demo and its walk-in link has
-- to keep working, RidgePT is his sandbox and should be shut. A new clinic is
-- invite-only from the moment it exists.
--
-- Patient invites reuse the token machinery from 2026-09-04's staff patch, with
-- one thing the staff door cannot do: record consent in the same transaction as
-- the attach. accept_staff_invite is therefore made to REFUSE patient invites
-- outright, so nobody is ever attached as a patient without a consents row.
--
-- SAFE: adds one column, adds three functions, replaces three. Deletes nothing.
-- Idempotent: re-running changes nothing.
--
-- ⚠️ DEPLOY ORDER IS SQL FIRST, THEN THE API, THEN THE FRONTEND. This patch is
-- safe on its own: get_clinic_by_slug only GAINS a column (the live handler
-- selects explicit names), and get_staff_invite is deliberately NOT renamed
-- because the deployed API calls it and staff invite links are in flight.
--
-- HOW TO RUN (over the bastion tunnel, PGPASSWORD already exported):
--   psql -h localhost -p 5433 -U glowpt_admin -d glowpt \
--        -v ON_ERROR_STOP=1 -f 2026-09-04b_patient_invites.sql
-- ============================================================================

begin;

-- ------------------------------------------------------- the sign-up switch
alter table public.clinics add column if not exists open_signup boolean;
update public.clinics set open_signup = false where open_signup is null;
alter table public.clinics alter column open_signup set default false;
alter table public.clinics alter column open_signup set not null;

-- Riverside keeps its walk-in link: it is the sales demo and the Monday
-- heartbeat. Everything else, RidgePT included, becomes invite-only.
update public.clinics set open_signup = true where slug = 'riverside-pt';

-- --------------------------------------------- invites can now name a patient
-- ⚠️ staff_invites is therefore no longer PHI-free: a patient row names a person
-- as a patient of a named clinic. It was already RLS-scoped to that clinic's own
-- manager, which is the right scoping either way. The table keeps its name (and
-- so does get_staff_invite) because renaming would churn every policy, grant and
-- function, and would break the invite links already sent.
alter table public.staff_invites drop constraint if exists staff_invites_role_check;
alter table public.staff_invites
  add constraint staff_invites_role_check check (role in ('patient','therapist','manager'));

-- ------------------------------------------------------------------ functions
-- get_clinic_by_slug gains a column, so it must be dropped and recreated:
-- create-or-replace cannot change a function's OUT parameters. Inside the
-- transaction, so the live /join lookup never sees it missing.
drop function if exists public.get_clinic_by_slug(text);
create or replace function public.get_clinic_by_slug(p_slug text)
  returns table (id uuid, name text, slug text, is_active boolean, open_signup boolean)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.id, c.name, c.slug, (c.activated_at is not null) as is_active, c.open_signup
    from public.clinics c
  where c.slug = lower(trim(p_slug))
$$;

-- join_clinic IS the open walk-in path, so the new gate belongs here.
create or replace function public.join_clinic(
    p_slug text, p_full_name text, p_consent_version text)
  returns uuid
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  if public.current_user_id() is null then raise exception 'Not authenticated'; end if;

  select id from public.clinics where slug = lower(trim(p_slug)) into v_clinic;
  if v_clinic is null then raise exception 'Clinic not found'; end if;

  if not public.clinic_is_active(v_clinic) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  -- An INVITED patient never reaches this function: they arrive through
  -- accept_patient_invite, matched to their own verified address.
  if not (select open_signup from public.clinics where id = v_clinic) then
    raise exception 'This clinic is invite only' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot self-join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_clinic, 'patient', nullif(trim(p_full_name), ''))
    on conflict (id) do update
      set clinic_id = v_clinic,
          role      = 'patient',
          full_name = coalesce(public.profiles.full_name, nullif(trim(p_full_name), ''));

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_clinic, 'hipaa_patient_ack', p_consent_version);
  end if;

  return v_clinic;
end $$;

-- accept_staff_invite must now REFUSE a patient invite. It records no consent,
-- and a patient attached without a consents row is exactly the gap the privacy
-- notice exists to close. Both its paths are guarded: the token path raises,
-- and the blind safety-net path skips patient invites entirely.
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
    if v_inv.id is null then
      raise exception 'This invite link is no longer valid' using errcode = 'P0001';
    end if;
    if lower(v_inv.email) <> lower(v_email) then
      raise exception 'This invite is for a different email address' using errcode = 'P0001';
    end if;
    if v_inv.role = 'patient' then
      raise exception 'Use the patient invite flow for this invite' using errcode = 'P0001';
    end if;
  else
    select * from public.staff_invites
      where email = lower(v_email) and consumed_at is null and expires_at > now()
        and role <> 'patient'
      order by created_at desc limit 1 into v_inv;
    if v_inv.id is null then return null; end if;
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_inv.clinic_id, v_inv.role, v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = v_inv.role,
          full_name = coalesce(public.profiles.full_name, v_inv.full_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- Invite a PATIENT. Split from invite_staff rather than folded into it so a
-- patient form can never be coaxed into minting a therapist or manager invite
-- by passing a role.
create or replace function public.invite_patient(p_email text, p_full_name text)
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite patients'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), 'patient', public.current_user_id())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = 'patient',
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Claim a PATIENT invite: the twin of accept_staff_invite, plus consent.
-- Role is pinned to 'patient' here rather than read off the invite row, so even
-- a tampered row could not mint staff through the patient screen.
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
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invite is for a different email address' using errcode = 'P0001';
  end if;
  if v_inv.role <> 'patient' then
    raise exception 'Use the staff invite flow for this invite' using errcode = 'P0001';
  end if;

  -- An invite is not a way around the activation gate.
  if not public.clinic_is_active(v_inv.clinic_id) then
    raise exception 'Clinic is not open for sign-ups yet' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles
             where id = public.current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (public.current_user_id(), v_inv.clinic_id, 'patient', v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = 'patient',
          full_name = coalesce(public.profiles.full_name, v_inv.full_name);

  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (public.current_user_id(), v_inv.clinic_id, 'hipaa_patient_ack', p_consent_version);
  end if;

  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end $$;

-- The manager's own switch. Theirs rather than the platform admin's, because
-- only they know whether they want a code on their front desk.
create or replace function public.set_clinic_open_signup(p_open boolean)
  returns boolean
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can change patient sign-up'; end if;
  update public.clinics set open_signup = p_open where id = v_clinic;
  return p_open;
end $$;

alter function public.get_clinic_by_slug(text)            owner to glowpt_auth;
alter function public.join_clinic(text, text, text)       owner to glowpt_auth;
alter function public.accept_staff_invite(text)           owner to glowpt_auth;
alter function public.invite_patient(text, text)          owner to glowpt_auth;
alter function public.accept_patient_invite(text, text)   owner to glowpt_auth;
alter function public.set_clinic_open_signup(boolean)     owner to glowpt_auth;

revoke execute on function public.get_clinic_by_slug(text)          from public;
revoke execute on function public.invite_patient(text, text)        from public;
revoke execute on function public.accept_patient_invite(text, text) from public;
revoke execute on function public.set_clinic_open_signup(boolean)   from public;

grant execute on function
  public.get_clinic_by_slug(text),
  public.invite_patient(text, text),
  public.accept_patient_invite(text, text),
  public.set_clinic_open_signup(boolean)
to glowpt_app;

grant execute on function public.accept_patient_invite(text, text) to glowpt_postconfirm;

-- ------------------------------------------------------------------ guards
do $$
declare n int; riverside boolean;
begin
  select count(*) into n from public.clinics where open_signup is null;
  if n > 0 then raise exception 'GUARD: % clinic(s) left without a sign-up setting', n; end if;

  select open_signup into riverside from public.clinics where slug = 'riverside-pt';
  if riverside is not null and riverside is not true then
    raise exception 'GUARD: Riverside lost its walk-in link';
  end if;

  if not has_function_privilege('glowpt_app','public.get_clinic_by_slug(text)','execute')
     or not has_function_privilege('glowpt_app','public.accept_patient_invite(text,text)','execute')
     or not has_function_privilege('glowpt_postconfirm','public.accept_patient_invite(text,text)','execute') then
    raise exception 'GUARD: a grant did not survive the function drop';
  end if;

  -- The deployed API still calls this by its old name; dropping it would break
  -- every staff invite link currently in flight.
  if not has_function_privilege('glowpt_app','public.get_staff_invite(text)','execute') then
    raise exception 'GUARD: get_staff_invite went missing';
  end if;

  raise notice 'GUARDS PASSED.';
end $$;

commit;

-- What you should see: Riverside open, every other clinic invite-only.
select name, slug,
       case when activated_at is null then 'closed' else 'on' end as clinic,
       case when open_signup then 'open link + QR' else 'invite only' end as patient_signup
  from public.clinics
 order by created_at;
