# GlowPT Phase 2 (Cognito) deploy runbook

**Purpose:** turn the authored + locally-validated Phase 2 code into live AWS
resources, then prove a real sign-up works end to end. This is the FIRST
paid/irreversible step of the migration, so it is done deliberately, together,
one step at a time. Account `glowpt-prod` (463556655381), region `us-east-1`.

**Standing rule from the migration docs: no em dashes in this file.**

## What this session creates (and the cost)
- A **Cognito user pool + web client** (passwordless email code login).
- A **post-confirmation Lambda** (nodejs22, arm64) that writes the new user into
  RDS and attaches their clinic.
- A **Secrets Manager secret** for the `glowpt_postconfirm` DB role, and an
  **update to the existing RDS Proxy** (adds that secret, turns on IAM auth).
- Rough added cost: **a few dollars a month** (Cognito Essentials is priced per
  monthly active user and is ~free at demo volume; the Lambda + secret are
  cents). No NAT gateway, no VPC endpoints (that is the whole point of Option A).

**The live app is untouched.** It still runs on Supabase. Nothing here is wired
into the React app yet (that is Phase 5). We test via the AWS CLI.

---

## Before you start
1. Fresh SSO login (the token lasts 8 hours):
   ```bash
   aws sso login --profile glowpt-prod
   ```
2. Work from the infra folder:
   ```bash
   cd /Users/mac/Downloads/glowpt/infra
   ```
3. Sanity check you are pointed at the right account:
   ```bash
   aws sts get-caller-identity --profile glowpt-prod --region us-east-1
   ```
   Expect account `463556655381`.

---

## GATE 1: preview the change (read-only, creates nothing)
```bash
npx cdk diff --profile glowpt-prod
```
Read it together. **Expected:** new Cognito pool + client, new Lambda + its
security group + role + log group, a new Secrets Manager secret, and an
**in-place UPDATE** to the DB proxy.

**STOP and reconsider if** the diff shows the RDS **instance** or the **proxy**
being **replaced/destroyed** (look for "may be replaced", "destroy",
"replacement"). The proxy should be a plain update. The database instance should
not appear as replaced at all. If it does, do not deploy; investigate first.

---

## GATE 2: deploy (this is the paid/irreversible step)
```bash
npx cdk deploy --profile glowpt-prod
```
CDK prints the security-relevant changes (new IAM statements, security-group
rule) and asks `Do you wish to deploy these changes (y/n)?` **Read them, then
type `y`.** Takes roughly 5 to 15 minutes.

When it finishes, note these outputs (printed at the end):
- `GlowptFoundation.AuthUserPoolId`  -> the user pool id
- `GlowptFoundation.AuthUserPoolClientId` (or `...WebClientId`) -> the app client id
- `GlowptFoundation.PostconfirmSecretArn`
- `GlowptFoundation.PostConfirmationPostConfirmFnName`
- `GlowptFoundation.DbProxyEndpoint` (unchanged from before)

---

## STEP 3: apply the DB patch (creates the glowpt_postconfirm role on RDS)
The Lambda logs in as `glowpt_postconfirm`, which does not exist on RDS yet. The
patch `db/patches/2026-08-18_postconfirm_role.sql` creates it, grants it the four
sign-up functions, and takes `register_user` away from the general app role. It
is idempotent and was proven locally.

3a. Start the bastion and wait ~1 minute for SSM to show it Online:
```bash
aws ec2 start-instances --instance-ids i-04b7a6d483e8b682a --profile glowpt-prod --region us-east-1
```

3b. Open the private tunnel to the DB **instance** (local port 5433). The
session-manager plugin is not on PATH, so prepend it:
```bash
export PATH="/usr/local/sessionmanagerplugin/bin:$PATH"
aws ssm start-session --target i-04b7a6d483e8b682a \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["glowptfoundation-databasepostgres277ef4cb-7l9zmtaid6jt.ci7a20as6ck9.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["5433"]}' \
  --profile glowpt-prod --region us-east-1
```
Leave that running; open a NEW terminal tab for the psql commands below.

3c. In the new tab, fetch the admin password into an env var (never printed) and
apply the patch:
```bash
export PSQL=/Applications/Postgres.app/Contents/Versions/latest/bin/psql
export ADMIN_ARN='<paste the DB admin secret ARN from CLAUDE.md>'
export PGPASSWORD="$(aws secretsmanager get-secret-value --secret-id "$ADMIN_ARN" --profile glowpt-prod --region us-east-1 --query SecretString --output text | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
"$PSQL" "host=localhost port=5433 dbname=glowpt user=glowpt_admin sslmode=require" \
  -v ON_ERROR_STOP=1 -f /Users/mac/Downloads/glowpt/db/patches/2026-08-18_postconfirm_role.sql
```
The patch prints two check rows; **both `ok` values must be `t`.**

---

## STEP 4: set the glowpt_postconfirm password to match its secret (screenshot-safe)
The proxy reaches the DB using the secret's password, so the DB role must carry
that exact password. This reads both secrets into env vars and never prints
them. Run in the same tab as 3c (tunnel still up, `PGPASSWORD` still the admin
password):
```bash
export PC_PW="$(aws secretsmanager get-secret-value --secret-id glowpt/db/postconfirm --profile glowpt-prod --region us-east-1 --query SecretString --output text | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
"$PSQL" "host=localhost port=5433 dbname=glowpt user=glowpt_admin sslmode=require" <<'SQL'
\getenv pw PC_PW
alter role glowpt_postconfirm with password :'pw';
SQL
unset PC_PW PGPASSWORD
```
Expect `ALTER ROLE`. Nothing sensitive was printed, so a screenshot is safe.

---

## STEP 5: acceptance test (the onboard path, via CLI)
The frontend is not wired yet, so we drive a real sign-up with the CLI. The
`onboard` flow is cleanest because it creates its own clinic (no pre-existing
data needed). Use a real Gmail +alias so the code reaches David's inbox.

> Note verified live: the post-confirmation trigger reads `ClientMetadata` from
> the **ConfirmSignUp** call, so it is passed there (Phase 5 frontend must do the
> same on confirm, not only on sign-up).

5a. Passwordless sign-up (omit any password; verify the exact flag shape live):
```bash
export CLIENT_ID='<AuthUserPoolClientId from the deploy outputs>'
aws cognito-idp sign-up --client-id "$CLIENT_ID" \
  --username besoulful+pc1@gmail.com \
  --user-attributes Name=email,Value=besoulful+pc1@gmail.com \
  --profile glowpt-prod --region us-east-1
```
A 6-digit code emails to `besoulful+pc1@gmail.com` (this is also the first real
SES send: confirm it lands in the inbox, not spam).

5b. Confirm, carrying the flow metadata the Lambda dispatches on:
```bash
aws cognito-idp confirm-sign-up --client-id "$CLIENT_ID" \
  --username besoulful+pc1@gmail.com \
  --confirmation-code <CODE FROM EMAIL> \
  --client-metadata flow=onboard,onboard_clinic_name="PC Test Clinic",onboard_clinic_slug=pc-test-clinic,full_name="David Test" \
  --profile glowpt-prod --region us-east-1
```

5c. Verify the chain ran (over the tunnel, screenshot-safe; no secrets in output):
```bash
"$PSQL" "host=localhost port=5433 dbname=glowpt user=glowpt_admin sslmode=require" \
  -c "select c.slug, p.role, u.email from clinics c join profiles p on p.clinic_id=c.id join users u on u.id=p.id where c.slug='pc-test-clinic';"
```
**Success = one row:** slug `pc-test-clinic`, role `manager`, the test email.
That proves Cognito -> SES email -> post-confirmation Lambda -> IAM auth to the
proxy -> register_user + provision_clinic, all working.

5d. If it returns 0 rows, check the Lambda log for the loud failure line:
```bash
aws logs tail /aws/lambda/glowpt-post-confirmation --since 15m --profile glowpt-prod --region us-east-1
```

5e. Clean up the test account + clinic when done (Cognito user + the DB rows).

---

## After the session
- Stop the bastion to save ~$3/mo:
  ```bash
  aws ec2 stop-instances --instance-ids i-04b7a6d483e8b682a --profile glowpt-prod --region us-east-1
  ```
- Update `CLAUDE.md`: Phase 2 DONE + PROVEN; next is Phase 3 (API Lambdas).

## If we need to back out
Cognito + the Lambda are additive and not wired into the live app, so the safe
rollback is simply to leave them unused, or `cdk destroy` the new bits later.
The RDS proxy change (iamAuth + extra secret) is harmless to the current app
(nothing uses the proxy in production yet). No data migration happened, so there
is nothing to restore.
