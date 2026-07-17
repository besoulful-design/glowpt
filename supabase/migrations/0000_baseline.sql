-- GlowPT baseline schema. Introspected from the live Supabase database.
-- Generated for Task 1 (Node introspection stand-in for pg_dump --schema-only).
-- Public schema only. Represents the CURRENT state (0001-0004 already applied live).

-- ============================ EXTENSIONS ============================
-- extension pg_cron 1.6.4 (schema pg_catalog)
-- extension pg_net 0.20.0 (schema extensions)
-- extension pg_stat_statements 1.11 (schema extensions)
-- extension pgcrypto 1.3 (schema extensions)
-- extension plpgsql 1.0 (schema pg_catalog)
-- extension supabase_vault 0.3.1 (schema vault)
-- extension uuid-ossp 1.1 (schema extensions)

-- ============================ TABLE public.access_log ============================
create table public.access_log (
  id uuid default gen_random_uuid() not null,
  actor_id uuid not null,
  action text not null,
  target_user_id uuid,
  clinic_id uuid,
  created_at timestamp with time zone default now() not null
);
alter table public.access_log add constraint access_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.access_log add constraint access_log_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.access_log add constraint access_log_pkey PRIMARY KEY (id);
CREATE INDEX access_log_clinic_idx ON public.access_log USING btree (clinic_id, created_at DESC);
alter table public.access_log enable row level security;

-- ============================ TABLE public.checkins ============================
create table public.checkins (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  feeling integer not null,
  feeling_word text,
  movements text[],
  note text,
  ai_response text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  other_movement text,
  clinic_id uuid
);
alter table public.checkins add constraint checkins_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
alter table public.checkins add constraint checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.checkins add constraint checkins_pkey PRIMARY KEY (id);
CREATE INDEX checkins_clinic_idx ON public.checkins USING btree (clinic_id, created_at DESC);
CREATE INDEX checkins_user_idx ON public.checkins USING btree (user_id, created_at DESC);
alter table public.checkins enable row level security;

-- ============================ TABLE public.clinics ============================
create table public.clinics (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  baa_signed_at timestamp with time zone,
  baa_version text,
  created_at timestamp with time zone default now() not null
);
alter table public.clinics add constraint clinics_pkey PRIMARY KEY (id);
alter table public.clinics add constraint clinics_slug_key UNIQUE (slug);
alter table public.clinics enable row level security;

-- ============================ TABLE public.consents ============================
create table public.consents (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  clinic_id uuid,
  type text default 'hipaa_patient_ack'::text not null,
  version text default 'v1'::text not null,
  consented_at timestamp with time zone default now() not null
);
alter table public.consents add constraint consents_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.consents add constraint consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.consents add constraint consents_pkey PRIMARY KEY (id);
CREATE INDEX consents_user_idx ON public.consents USING btree (user_id);
alter table public.consents enable row level security;

-- ============================ TABLE public.profiles ============================
create table public.profiles (
  id uuid not null,
  clinic_id uuid,
  role text default 'patient'::text not null,
  full_name text,
  therapist_id uuid,
  created_at timestamp with time zone default now() not null,
  discharged_at timestamp with time zone
);
alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['patient'::text, 'therapist'::text, 'manager'::text])));
alter table public.profiles add constraint profiles_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
CREATE INDEX profiles_clinic_idx ON public.profiles USING btree (clinic_id);
CREATE INDEX profiles_therapist_idx ON public.profiles USING btree (therapist_id);
alter table public.profiles enable row level security;

-- ============================ TABLE public.staff_invites ============================
create table public.staff_invites (
  id uuid default gen_random_uuid() not null,
  clinic_id uuid not null,
  email text not null,
  full_name text,
  role text default 'therapist'::text not null,
  invited_by uuid,
  created_at timestamp with time zone default now() not null,
  consumed_at timestamp with time zone
);
alter table public.staff_invites add constraint staff_invites_role_check CHECK ((role = ANY (ARRAY['therapist'::text, 'manager'::text])));
alter table public.staff_invites add constraint staff_invites_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
alter table public.staff_invites add constraint staff_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.staff_invites add constraint staff_invites_pkey PRIMARY KEY (id);
alter table public.staff_invites add constraint staff_invites_clinic_id_email_key UNIQUE (clinic_id, email);
CREATE INDEX staff_invites_email_idx ON public.staff_invites USING btree (email) WHERE (consumed_at IS NULL);
alter table public.staff_invites enable row level security;

-- ============================ FUNCTIONS (public) ============================
CREATE OR REPLACE FUNCTION public.accept_staff_invite()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text; v_inv record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select email from auth.users where id = auth.uid() into v_email;
  select * from public.staff_invites
    where email = lower(v_email) and consumed_at is null
    order by created_at desc limit 1 into v_inv;
  if v_inv.id is null then return null; end if;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (auth.uid(), v_inv.clinic_id, v_inv.role, v_inv.full_name)
    on conflict (id) do update
      set clinic_id = v_inv.clinic_id, role = v_inv.role,
          full_name = coalesce(profiles.full_name, v_inv.full_name);
  update public.staff_invites set consumed_at = now() where id = v_inv.id;
  return v_inv.clinic_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_therapist(p_patient uuid, p_therapist uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can assign therapists'; end if;
  if not exists (select 1 from public.profiles
                 where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic';
  end if;
  if p_therapist is not null and not exists (
      select 1 from public.profiles
      where id = p_therapist and clinic_id = v_clinic and role = 'therapist') then
    raise exception 'Therapist not in your clinic';
  end if;
  update public.profiles set therapist_id = p_therapist where id = p_patient;
end;
$function$;

CREATE OR REPLACE FUNCTION public.auth_clinic_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select clinic_id from public.profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.auth_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select role from public.profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.discharge_patient(p_patient uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can discharge patients'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic'; end if;
  update public.profiles set discharged_at = now() where id = p_patient;
end; $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.invite_staff(p_email text, p_full_name text, p_role text DEFAULT 'therapist'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can invite staff'; end if;
  if p_role not in ('therapist','manager') then raise exception 'Invalid role'; end if;
  insert into public.staff_invites (clinic_id, email, full_name, role, invited_by)
  values (v_clinic, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, auth.uid())
  on conflict (clinic_id, email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), consumed_at = null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_my_patient(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (select 1 from public.profiles where id = p_user and therapist_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.provision_clinic(p_name text, p_slug text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_clinic_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.clinics (name, slug) values (p_name, p_slug) returning id into v_clinic_id;
  insert into public.profiles (id, clinic_id, role, full_name)
    values (auth.uid(), v_clinic_id, 'manager', null)
    on conflict (id) do update set clinic_id = v_clinic_id, role = 'manager';
  return v_clinic_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_patient(p_patient uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_clinic uuid;
begin
  select clinic_id from public.profiles where id = auth.uid() and role = 'manager' into v_clinic;
  if v_clinic is null then raise exception 'Only a clinic manager can restore patients'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and clinic_id = v_clinic and role = 'patient') then
    raise exception 'Patient not in your clinic'; end if;
  update public.profiles set discharged_at = null where id = p_patient;
end; $function$;

-- ============================ ROW-LEVEL SECURITY POLICIES ============================
-- policies on public.access_log
create policy access_log_insert_own on public.access_log for insert to authenticated with check ((actor_id = auth.uid()));
create policy access_log_select_clinic on public.access_log for select to authenticated using (((auth_role() = 'manager'::text) AND (clinic_id = auth_clinic_id())));
-- policies on public.checkins
create policy "Allow anonymous inserts for testing" on public.checkins for insert to public with check (true);
create policy "Users can insert their own checkins" on public.checkins for insert to public with check ((auth.uid() = user_id));
create policy "Users can view their own checkins" on public.checkins for select to public using ((auth.uid() = user_id));
create policy checkins_insert_own on public.checkins for insert to authenticated with check (((user_id = auth.uid()) AND (clinic_id = auth_clinic_id())));
create policy checkins_select_caseload on public.checkins for select to authenticated using (((auth_role() = 'therapist'::text) AND (clinic_id = auth_clinic_id()) AND is_my_patient(user_id)));
create policy checkins_select_clinic on public.checkins for select to authenticated using (((auth_role() = 'manager'::text) AND (clinic_id = auth_clinic_id())));
create policy checkins_select_own on public.checkins for select to authenticated using ((user_id = auth.uid()));
create policy checkins_update_own on public.checkins for update to authenticated using ((user_id = auth.uid())) with check (((user_id = auth.uid()) AND (clinic_id = auth_clinic_id())));
-- policies on public.clinics
create policy clinics_select on public.clinics for select to anon, authenticated using (true);
-- policies on public.consents
create policy consents_insert_own on public.consents for insert to authenticated with check ((user_id = auth.uid()));
create policy consents_select_clinic on public.consents for select to authenticated using (((auth_role() = ANY (ARRAY['therapist'::text, 'manager'::text])) AND (clinic_id = auth_clinic_id())));
create policy consents_select_own on public.consents for select to authenticated using ((user_id = auth.uid()));
-- policies on public.profiles
create policy profiles_insert_self on public.profiles for insert to authenticated with check ((id = auth.uid()));
create policy profiles_select_caseload on public.profiles for select to authenticated using (((auth_role() = 'therapist'::text) AND (therapist_id = auth.uid())));
create policy profiles_select_clinic on public.profiles for select to authenticated using (((auth_role() = 'manager'::text) AND (clinic_id = auth_clinic_id())));
create policy profiles_select_self on public.profiles for select to authenticated using ((id = auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));
-- policies on public.staff_invites
create policy staff_invites_select_clinic on public.staff_invites for select to authenticated using (((auth_role() = 'manager'::text) AND (clinic_id = auth_clinic_id())));
