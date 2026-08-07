# GlowPT AWS Migration: Phase 2 (Auth / Cognito) Design

**Design only. No AWS resource provisioned yet. Written 2026-08-07.**
Companion to `glowpt-aws-migration-plan.md` (Phase 2) and `db/schema.sql`.
Standing rule from the migration docs still holds: no em dashes in this file.

Grounded in current Amazon Cognito docs (Essentials tier, choice-based
`USER_AUTH` passwordless email OTP). Exact API parameter names are verified again
at implementation time (Phase 2.3), since they are the kind of detail that moves.

---

## 1. What Phase 2 replaces

Today, sign-in is Supabase passwordless 6-digit email OTP (`signInWithOtp` ->
type code -> `verifyOtp`). Roles live in `public.profiles.role`, never in a token
(confirmed in the inventory). So Cognito only has to do ONE job: prove who a user
is and hand back a stable subject id. It does NOT carry roles or make access
decisions. RLS remains the authorization boundary (migration Rule 3).

## 2. Decision 2.1 (settled 2026-08-07): accounts are clinic-only

An account is created ONLY on these three paths:

| Path | Who | Result |
|---|---|---|
| `/join/<slug>` | a patient with a clinic link | patient attached to that clinic + consent |
| staff-invite accept | an invited therapist/manager | staff attached to their clinic |
| `/onboard` | a new clinic manager | new clinic provisioned, caller becomes manager |

A plain `/login` with an email we do not recognize creates NOTHING. It returns a
friendly "we don't recognize this email, use the link or invite from your clinic"
message. This retires the V2.4 orphan/no-clinic account class by construction.

Mechanically: on Cognito we call `SignUp` ONLY from those three paths. `/login`
only ever calls sign-in for an existing user, never `SignUp`.

## 3. Cognito user pool configuration

- **Feature plan:** Essentials (required for choice-based / passwordless).
- **Sign-in identifier:** email. No username, no phone.
- **Passwordless email OTP**, via choice-based auth (`USER_AUTH` /
  `ALLOW_USER_AUTH`). Passwordless sign-in enabled on both the user pool AND the
  app client. Password is omitted/blank at `SignUp` (allowed once passwordless is
  active). No password ever exists.
- **Custom SDK integration** (`@aws-sdk/client-cognito-identity-provider` or
  Amplify auth), NOT the Hosted UI / managed login. The Hosted UI path forces
  passwords, which defeats the whole model. This mirrors today: everything stays
  in one browser tab, which is exactly why the current OTP-code approach beat
  magic links.
- **Email delivery:** Amazon SES, using the verified `glowpt.app` identity, From
  something like `GlowPT <no-reply@glowpt.app>`. Cognito's built-in email is
  capped (about 50/day) and is dev-only. **This is why Phase 2 email depends on
  the pending SES production-access approval.** Until SES is approved + wired,
  the pool can run on Cognito default email for internal testing only.
- **User-existence protection:** keep Cognito's "prevent user existence errors"
  ON, so `/login` cannot be used to enumerate which emails are GlowPT patients
  (a privacy concern: it reveals someone is in PT). The `/login` "unknown email"
  message stays generic. Small UX-vs-privacy call, resolved toward privacy.
- **MFA:** none. The email OTP is itself the single passwordless factor.
- **Standard attribute:** `email` (required). See metadata mapping below for the
  rest; we do NOT store app metadata as Cognito custom attributes.

## 4. The sign-up + attach flow (all three creation paths)

The key idea: a **post-confirmation Lambda** does the database work, server-side,
right after the user proves their email. It reuses the exact SECURITY DEFINER
functions already built and tested in `db/schema.sql`, so authorization is never
duplicated in Lambda code.

**Frontend `SignUp` call** carries the path context in `ClientMetadata` (which
Cognito delivers to Lambda triggers, and which is NOT persisted):

| Path | ClientMetadata sent |
|---|---|
| patient join | `{ flow: 'join', clinic_slug, full_name, consent_version }` |
| clinic onboard | `{ flow: 'onboard', onboard_clinic_name, onboard_clinic_slug, full_name }` |
| staff invite | `{ flow: 'staff' }` (the invite is matched by email, no slug needed) |

**Then:** Cognito emails the OTP -> user types it -> `ConfirmSignUp` -> the
**post-confirmation Lambda** fires and, connected to RDS as `glowpt_app`, runs one
transaction:

```
set_config('app.user_id', <new Cognito sub>, true)   -- verified, from the event
register_user(sub, email, full_name)                 -- creates public.users + bare profile
-- then dispatch on ClientMetadata.flow:
  join    -> join_clinic(clinic_slug, full_name, consent_version)
  onboard -> provision_clinic(onboard_clinic_name, onboard_clinic_slug)
  staff   -> accept_staff_invite()
```

Every one of `register_user`, `join_clinic`, `provision_clinic`,
`accept_staff_invite` already exists and is proven by the Phase 1.3 tests. All are
idempotent (on-conflict), so a Lambda retry is safe.

**Safety net:** if the post-confirmation Lambda ever fails after Cognito has
confirmed the user, the user would exist with a bare profile and no clinic. The
existing NoClinic gate catches that gracefully, and the frontend re-runs the
attach (same idempotent RPC) on first sign-in. So a Lambda hiccup degrades to the
current behavior, never to data loss.

## 5. The sign-in flow (returning user)

Passwordless email OTP via `USER_AUTH`:
1. App calls `InitiateAuth` with `AuthFlow = USER_AUTH` for the email.
2. Cognito responds with the `EMAIL_OTP` challenge and emails a code.
3. App collects the code and answers the challenge; Cognito returns JWT tokens.

Newly-confirmed users can auto-sign-in immediately by passing the `Session` from
the `ConfirmSignUp` response into `InitiateAuth`, so a patient who just joined
does not have to request a second code.

## 6. What the app does with the token (Phase 5 preview, noted so it is not lost)

- Cognito returns id / access / refresh JWTs. This replaces Supabase's
  localStorage session. Decide token storage deliberately in Phase 5 (in-memory
  access token + refresh, vs storage); anything moving to httpOnly cookies is a
  frontend behavior change, not a drop-in.
- In Phase 3, the API Gateway authorizer verifies the Cognito JWT and the Lambda
  reads `sub` from it, then `set_config('app.user_id', sub, true)`. The authorizer
  proves identity; it does NOT choose rows. RLS does (Rule 3).
- No identifier (sub, email, id) ever goes in a URL path or query string (Rule 4).

## 7. Signup metadata mapping (the 5 fields)

The inventory found signup metadata riding on `signInWithOtp`'s `data`:
`full_name`, `clinic_slug`, `consent_version`, `onboard_clinic_name`,
`onboard_clinic_slug`. None is trusted for authorization (roles are server-side).
Mapping: pass them through `ClientMetadata` to the post-confirmation Lambda (as in
section 4), NOT as Cognito custom attributes. Reason: they are one-time
setup inputs, not durable identity facts, and the Lambda consumes them once to
call the right RPC. Keeping them out of the token/attributes keeps the token thin.

## 8. Infrastructure-as-code choice (needs David's nod)

Rule 7: everything provisioned as code, not console clicks, from the first
resource. Two options:

- **AWS CDK (TypeScript)** RECOMMENDED. Same language as the app (React/JS), one
  toolchain end to end, first-class AWS constructs for Cognito + Lambda + RDS,
  and it suits the Lambda-heavy phases 3 and 4.
- **Terraform (HCL).** Cloud-agnostic, huge community, arguably simpler to read.
  A fine choice; just a second language in the repo.

This is a foundational decision (it governs ALL remaining provisioning), so it is
made once, up front, when we stand up the AWS foundation.

## 9. Dependencies and open items (why Phase 2 build interleaves with the foundation)

Phase 2 DESIGN is done (this doc). Phase 2 BUILD needs, in rough order:

1. **IaC tool chosen** (section 8) + the AWS foundation stood up (VPC, RDS,
   RDS Proxy). The post-confirmation Lambda writes to the database, so RDS must
   exist. This is the not-yet-built part of the migration plan's "Phase 0."
2. **SES production access** (pending AWS review) for real OTP email at volume.
   Internal testing can use Cognito default email first.
3. **The post-confirmation Lambda** needs VPC egress to reach RDS, and a DB role
   (`glowpt_app`) credential.
4. Confirm the exact current Cognito API parameter names for passwordless
   `SignUp` / `USER_AUTH` at build time.
5. Phase-2 refinement carried from Phase 1: consider giving the post-confirmation
   Lambda a dedicated DB role rather than the general `glowpt_app`, so the app
   role cannot call `register_user` to mint arbitrary identities.

## 10. What Cognito deliberately does NOT change

- Roles stay in `public.profiles`, not in JWT claims. No custom claims, no
  pre-token-generation Lambda, no Cognito groups on day one.
- RLS stays the authorization boundary.
- The one-tab, type-the-code experience is preserved (custom SDK, no Hosted UI).

---

## Sources
- Cognito authentication flows (USER_AUTH / choice-based): https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html
- Passwordless sign-up / omitting passwords: https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html
- Essentials plan features: https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html
- Passwordless email authentication walkthrough: https://aws.amazon.com/blogs/mobile/implementing-passwordless-email-authentication-with-amazon-cognito/
