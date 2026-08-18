# GlowPT: Design for the `profiles_update_self` fix (Observation 10.2)

**Phase 1 implementation reference for Claude Code. Designed with David, July 17, 2026.**
**Companion to `glowpt-aws-migration-plan.md` (see Phase 1 and Rule 4).**

This is design only. Nothing was implemented. AWS does not exist yet. This is the "design with David before implementing" deliverable the plan asked for.

---

## The hole, restated

Live policy (from `0000_baseline.sql`):

```sql
create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((id = auth.uid()))
  with check ((id = auth.uid()));
```

It scopes the row (your own) but not the columns, and `authenticated` holds a table-wide UPDATE grant behind it. So any authenticated user runs `update profiles set role='manager', clinic_id='<any clinic uuid>' where id = auth.uid()`, both clauses pass, and they are now a manager of a clinic they have no relationship with. `auth_role()` and `auth_clinic_id()` then return manager + that clinic, and `profiles_select_clinic` / `checkins_select_clinic` hand them every patient name and free-text note in it. This is step 2 of the confidentiality breach in the plan's "two holes" section (hole 2 gives write, this gives read).

## Every legitimate client write to `profiles` (traced in `auth.jsx`)

1. **`auth.jsx:72`** `update({ full_name }).eq('id', userId)` after `provision_clinic`. Touches `full_name` only. Legitimate.
2. **`auth.jsx:84`** `upsert({ id, clinic_id, role: 'patient', full_name }, { onConflict:'id' })` in the patient-join flow, followed by a separate `consents` insert at `:89`. This sends `role` and `clinic_id` from the browser. Harmless as written, but it is the doorway: the database trusts a client-supplied role.

Every other write of `role` / `clinic_id` / `therapist_id` / `discharged_at` already routes through a `SECURITY DEFINER` function (`provision_clinic`, `accept_staff_invite`, `assign_therapist`, `discharge_patient`, `restore_patient`). Those are correct and are not changed by this design.

## Decisions confirmed with David

1. **`full_name` is the only column a patient may self-edit.** Nothing else. The column lock is set to exactly `full_name`.
2. **A staff member (manager/therapist) who lands on a patient join link is refused, not downgraded.** `join_clinic` raises rather than converting them to a patient.
3. **Consent is recorded inside the join function, atomically.** A patient can never end up attached with no consent row.

---

## The fix, two mechanisms plus a defense-in-depth cleanup

### Mechanism 1: column-level UPDATE grant (this is what actually closes 10.2)

An RLS policy scopes rows; column-level grants scope columns. The app connects as one non-owner role, `glowpt_app` (plan Rule 2). Replace the table-wide UPDATE grant with a column-scoped one:

```sql
revoke update on public.profiles from glowpt_app;
grant  update (full_name) on public.profiles to glowpt_app;

create policy profiles_update_self on public.profiles
  for update to glowpt_app
  using      (id = current_user_id())
  with check (id = current_user_id());
```

A `set role = 'manager'` now fails with `permission denied for column role` at the database, independent of anything the client sends. `auth.jsx:72` needs no change; it writes only `full_name`.

### Mechanism 2: `join_clinic()`, a `SECURITY DEFINER` function replacing the client-side join upsert

Because `glowpt_app` can no longer write `clinic_id`/`role` directly, the patient join moves server-side, mirroring `accept_staff_invite`. Role is pinned to `'patient'` in the database; the clinic is resolved from the slug (the existing self-serve join-link model), never a client-chosen uuid.

```sql
create or replace function public.join_clinic(
    p_slug text, p_full_name text, p_consent_version text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  set row_security = off          -- deliberate, narrow bypass; see Rule 4 note
as $$
declare v_clinic uuid;
begin
  if current_user_id() is null then
    raise exception 'Not authenticated';
  end if;

  select id from public.clinics where slug = lower(trim(p_slug)) into v_clinic;
  if v_clinic is null then
    raise exception 'Clinic not found';
  end if;

  -- Decision 2: refuse to downgrade an existing staff member.
  if exists (select 1 from public.profiles
             where id = current_user_id()
               and role <> 'patient'
               and clinic_id is not null) then
    raise exception 'Staff account cannot self-join as a patient';
  end if;

  insert into public.profiles (id, clinic_id, role, full_name)
    values (current_user_id(), v_clinic, 'patient', nullif(trim(p_full_name), ''))
    on conflict (id) do update
      set clinic_id = v_clinic,
          role      = 'patient',
          full_name = coalesce(public.profiles.full_name, excluded.full_name);

  -- Decision 3: consent recorded atomically in the same transaction.
  if p_consent_version is not null then
    insert into public.consents (user_id, clinic_id, type, version)
    values (current_user_id(), v_clinic, 'hipaa_patient_ack', p_consent_version);
  end if;

  return v_clinic;
end;
$$;
grant execute on function public.join_clinic(text, text, text) to glowpt_app;
```

Notes for the implementer:
- `current_user_id()` resolves correctly inside a `SECURITY DEFINER` function: DEFINER changes the executing role, not the transaction-local `app.user_id` GUC that `current_user_id()` reads. Same behavior `auth.uid()` had.
- The `on conflict do update` uses `coalesce(public.profiles.full_name, excluded.full_name)` so a re-join never blanks an existing name, matching `accept_staff_invite`'s pattern at `0002:64`.
- Owner: this function must be owned by a role that is **not** `glowpt_app` (a dedicated owner such as `glowpt_owner`), same as the other privileged functions. See Rule 4 note.

### Mechanism 3: no direct INSERT on `profiles` for the app (defense in depth)

The symmetric hole is INSERT: `profiles_insert_self` plus a table-wide INSERT grant would let a user create their own row as a manager. On Supabase the signup trigger pre-creates the row so an insert collides, which is luck, not a control. On AWS, profile rows are created only by (a) the Cognito post-confirmation Lambda carrying the `handle_new_user` logic, and (b) the `SECURITY DEFINER` functions (`provision_clinic`, `accept_staff_invite`, `join_clinic`). Therefore:

```sql
-- glowpt_app gets NO direct insert on profiles.
-- (No grant issued. The post-confirmation path and the definer functions do all inserts.)
```

Resulting `glowpt_app` privileges on `public.profiles`:

| Privilege | Granted to `glowpt_app`? | Why |
|---|---|---|
| SELECT | Yes | RLS scopes it to self / clinic / caseload |
| UPDATE (`full_name`) | Yes, column-scoped | The only self-service edit |
| UPDATE (other columns) | No | Closes 10.2 |
| INSERT | No | Rows created by post-confirmation Lambda + definer functions |
| DELETE | No | Discharge is a soft-delete via `discharge_patient`; hard delete is admin-only |

---

## Frontend change (Phase 5, noted here so it is not lost)

`auth.jsx` lines 80-93 collapse. The `clinics` slug lookup, the `profiles` upsert, and the `consents` insert all become one call:

```js
// before: select clinic by slug, upsert profile with role, insert consent
// after:
if (joinSlug) {
  await callApi('join_clinic', {           // API Gateway route -> join_clinic()
    p_slug: joinSlug,
    p_full_name: name,
    p_consent_version: joinConsent || null,
  })
}
```

`auth.jsx:72` (the `full_name` update after `provision_clinic`) stays as a direct update; the column grant permits it.

---

## Tests that must pass (plan Phase 1 requires them)

Must **fail**:
1. Authenticated patient runs `update profiles set role='manager', clinic_id='<any>' where id = current_user_id()` -> `permission denied for column role` (and for `clinic_id`).
2. Attempt to join while forcing a role: there is no parameter to do so; the resulting row is `role='patient'` every time.
3. Authenticated user attempts a direct `insert into profiles (...) values (..., 'manager', ...)` -> denied (no INSERT grant).
4. A manager/therapist calls `join_clinic` -> raises `Staff account cannot self-join as a patient`; their row is unchanged.

Must **succeed**:
5. Patient updates only their `full_name` -> succeeds.
6. New patient calls `join_clinic('<valid-slug>', 'Name', 'v1')` -> attached as patient with a consent row written in the same transaction.

---

## Rule 4 connection (do these together)

`join_clinic`, `provision_clinic`, and `accept_staff_invite` all write `profiles`, and `auth_role()` / `auth_clinic_id()` / `is_my_patient()` all read `profiles`. Under `FORCE ROW LEVEL SECURITY` (Rule 3), even the function owner is subject to RLS unless the function sets `row_security = off` or is owned by a bypass role. So every one of these functions needs the same treatment: `SECURITY DEFINER`, owned by a dedicated non-`glowpt_app` role, with `set row_security = off`. This fix and Rule 4 are one piece of work; sequence them together in Phase 1, step 2.
