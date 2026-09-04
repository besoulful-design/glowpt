-- GlowPT patch: staff invite LINKS (2026-09-04)
-- ============================================================================
-- WHY: "Invite Therapist" wrote a pending row and nothing else. The therapist
-- was expected to sign in at /login and be matched by email, which worked on
-- Supabase because /login created accounts for any address. The AWS cutover
-- removed that (accounts are created only through a clinic door), so there was
-- no way for a new staff member to get an account at all. This adds the missing
-- door: an invite link the manager can send.
--
-- ⚠️ THE TOKEN IS NOT THE CREDENTIAL. It says WHICH invite is being claimed.
-- accept_staff_invite additionally requires the signed-in user's VERIFIED email
-- to equal the invited email, so a forwarded or leaked link grants nothing.
-- That check lives here, in the database, not in the frontend.
--
-- SAFE: adds two columns, adds two functions, replaces two. Deletes nothing.
-- Existing pending invites (PT Pete's included) are given a token and a 14-day
-- expiry in place, so they become sendable links without re-inviting anyone.
-- Idempotent: re-running changes nothing.
--
-- HOW TO RUN (over the bastion tunnel, PGPASSWORD already exported):
--   psql -h localhost -p 5433 -U glowpt_admin -d glowpt \
--        -v ON_ERROR_STOP=1 -f 2026-09-04_staff_invite_tokens.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------- token minter
-- 256 bits of randomness as hex, from two v4 uuids. gen_random_uuid() is built
-- in from PG13, so no extension is needed.
create or replace function public.new_invite_token() returns text
  language sql volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;
alter function public.new_invite_token() owner to glowpt_auth;
revoke execute on function public.new_invite_token() from public;

-- --------------------------------------------------------------- the two columns
-- Added nullable, backfilled, then tightened: that sequence is re-runnable,
-- whereas "add column not null default <volatile>" is not.
alter table public.staff_invites add column if not exists token      text;
alter table public.staff_invites add column if not exists expires_at timestamptz;

update public.staff_invites set token      = public.new_invite_token()  where token is null;
update public.staff_invites set expires_at = now() + interval '14 days' where expires_at is null;

alter table public.staff_invites alter column token      set default public.new_invite_token();
alter table public.staff_invites alter column token      set not null;
alter table public.staff_invites alter column expires_at set default now() + interval '14 days';
alter table public.staff_invites alter column expires_at set not null;

create unique index if not exists staff_invites_token_key on public.staff_invites (token);

-- ------------------------------------------------------------------- functions
-- ⚠️ BOTH must be DROPPED first, not "create or replace"d:
--   * invite_staff changes its RETURN TYPE (void -> text), which replace refuses.
--   * accept_staff_invite gains a defaulted argument, which is a NEW signature;
--     leaving the old zero-arg one in place makes accept_staff_invite() an
--     ambiguous call and every safety-net invocation would start failing.
-- Inside this transaction, so other sessions keep seeing the old definitions
-- until commit and the live app never observes a missing function.
-- (Dropping a function also drops its grants; they are re-granted at the end.)
drop function if exists public.invite_staff(text, text, text);
drop function if exists public.accept_staff_invite();

-- Returns the invite TOKEN so the caller can build the link to send. Re-inviting
-- the same address mints a FRESH token and expiry and clears consumed_at -- that
-- is deliberately how a link sent to the wrong place gets invalidated.
create or replace function public.invite_staff(
    p_email text, p_full_name text, p_role text default 'therapist')
  returns text
  language plpgsql security definer
  set search_path = public set row_security = off
as $$
declare v_clinic uuid; v_token text;
begin
  select clinic_id from public.profiles where id = public.current_user_id() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, public.current_user_id())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null,
        token = public.new_invite_token(), expires_at = now() + interval '14 days'
  returning token into v_token;
  return v_token;
end $$;

-- Read an invite by its token WITHOUT being signed in, so the staff sign-up
-- screen can name the clinic and the role before the person has an account.
-- Same unauthenticated shape as get_clinic_by_slug. It reveals the invited email
-- to whoever holds the token, which is the point of an invite link; the token is
-- the secret, and holding it still does not let the wrong person claim the role.
-- An unknown, expired or already-used token returns zero rows.
create or replace function public.get_staff_invite(p_token text)
  returns table (clinic_name text, clinic_slug text, email text, full_name text, role text)
  language sql stable security definer
  set search_path = public set row_security = off
as $$
  select c.name, c.slug, i.email, i.full_name, i.role
    from public.staff_invites i
    join public.clinics c on c.id = i.clinic_id
   where i.token = p_token
     and i.consumed_at is null
     and i.expires_at > now()
$$;

-- Claim a staff invite and become therapist/manager of its clinic.
--
-- p_token null is the FRONTEND SAFETY NET (auth.jsx re-runs this blind on first
-- sign-in in case the post-confirmation Lambda missed). That path matches on
-- email alone and returns null rather than raising, because it is a speculative
-- retry for a user who usually has no invite at all. It now also respects
-- expiry, so a lapsed invitee is not silently attached later.
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
    if lower(v_inv.email) <> lower(v_email) then
      raise exception 'This invite is for a different email address' using errcode = 'P0001';
    end if;
  else
    select * from public.staff_invites
      where email = lower(v_email) and consumed_at is null and expires_at > now()
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

alter function public.invite_staff(text, text, text) owner to glowpt_auth;
alter function public.get_staff_invite(text)         owner to glowpt_auth;
alter function public.accept_staff_invite(text)      owner to glowpt_auth;

revoke execute on function public.invite_staff(text, text, text) from public;
revoke execute on function public.get_staff_invite(text)         from public;
revoke execute on function public.accept_staff_invite(text)      from public;

grant execute on function
  public.invite_staff(text, text, text),
  public.get_staff_invite(text),
  public.accept_staff_invite(text)
to glowpt_app;

grant execute on function public.accept_staff_invite(text) to glowpt_postconfirm;

-- ------------------------------------------------------------------ guards
-- Read these BEFORE the commit below. Every line must be true.
do $$
declare n int;
begin
  select count(*) into n from public.staff_invites where token is null or expires_at is null;
  if n > 0 then raise exception 'GUARD: % invite(s) left without a token or expiry', n; end if;

  select count(distinct token) into n from public.staff_invites;
  if n <> (select count(*) from public.staff_invites) then
    raise exception 'GUARD: invite tokens are not unique';
  end if;

  if not has_function_privilege('glowpt_app','public.get_staff_invite(text)','execute')
     or not has_function_privilege('glowpt_app','public.accept_staff_invite(text)','execute')
     or not has_function_privilege('glowpt_postconfirm','public.accept_staff_invite(text)','execute') then
    raise exception 'GUARD: a grant did not survive the function drop';
  end if;

  -- The old zero-arg overload must be GONE, or accept_staff_invite() is ambiguous.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'accept_staff_invite';
  if n <> 1 then raise exception 'GUARD: % accept_staff_invite overloads exist, want 1', n; end if;

  raise notice 'GUARDS PASSED: % invite(s) now carry a link.', (select count(*) from public.staff_invites);
end $$;

commit;

-- What you should see after committing: one row per outstanding invite, each
-- with its own token and an expiry two weeks out. No email addresses are printed.
select clinic_id, role, expires_at::date as expires,
       case when consumed_at is null then 'pending' else 'used' end as state,
       left(token, 8) || '...' as token_preview
  from public.staff_invites
 order by created_at desc;
