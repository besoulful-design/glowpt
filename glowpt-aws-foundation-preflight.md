# GlowPT — AWS Foundation Session: Pre-Flight Checklist
*Written 2026-08-10, right after SES production access was granted. Plain-language prep so the next (big) session starts clean. Local/uncommitted planning doc, same as the others.*

## Where we are
SES production access is **granted** (out of the sandbox: 50,000 emails/day, 14/sec). That was the last thing we were waiting on. Everything on the "account + email" side is done:

- ✅ AWS org + `glowpt-prod` account
- ✅ Org-level AWS BAA (Active — covers `glowpt-prod` automatically)
- ✅ SES domain verified (DKIM + custom MAIL FROM), bounce/complaint plumbing staged
- ✅ SES out of the sandbox
- ✅ Database schema written + proven (14/14 security tests pass locally)
- ✅ Cognito auth designed

**The next session builds the actual cloud infrastructure in code (AWS CDK).** That's a big one: it touches live AWS and starts costing a little money. We do it slowly, one step at a time, on a fresh head — not tired.

## Before that session: 3 small setup steps (no AWS cost)
These just install tools on the laptop and connect them to your AWS account. Nothing here builds anything or spends money. All three are currently **missing** (checked 2026-08-10).

**1. Install the AWS CLI (command-line tool).**
- What it is: the official app that lets the laptop talk to AWS.
- How: download AWS's macOS installer (`.pkg`) and run it. **This one asks for your Mac admin password** (the installer needs it) — so it's yours to run; I'll give you the exact link and click-steps when we start.
- Node.js and npm are already installed ✅ (needed for the next step), so no action there.

**2. Install AWS CDK (the infrastructure-as-code tool).**
- What it is: lets us describe the whole cloud setup (database, network, etc.) in TypeScript — the same language family as the GlowPT app — instead of clicking through the AWS console. That way it's repeatable and reviewable.
- How: one command, `npm install -g aws-cdk`. May or may not need your password depending on the laptop; we'll see.

**3. Connect the tools to AWS, then "bootstrap".**
- `aws configure sso` — points the CLI at your access portal (`https://d-906678b3ec.awsapps.com/start`), region `us-east-1`, account `glowpt-prod` (463556655381). You sign in the normal way (password + iPhone Google Authenticator).
- `cdk bootstrap` — a one-time prep that gives CDK a small staging area in the account. Creates a tiny S3 bucket; effectively free.

I'll walk you through each of these one message at a time, explaining what each does before you run it. **We can do all three now if you're up for it, or at the top of the next session.**

## What the foundation session itself builds (for context, not now)
In CDK, one careful step at a time:
- **VPC** — a private network for the database so it isn't exposed to the internet
- **RDS Postgres 17.6** — the real database, with **encryption turned on at creation** (required for HIPAA) and SSL forced
- **RDS Proxy** — sits in front of the database so serverless functions can share connections safely
- **Automated backups**, NAT / VPC endpoints
- **CloudTrail** — an audit log kept 6 years (HIPAA expectation)
- **SES config set** with TLS `Require`

Then: apply `db/schema.sql` to the new database and **re-run the 14 security tests on it** to confirm everything works on the real thing (the one open question is whether RDS lets us create the special database role — we verify it here).

After that comes Phase 2.3 (Cognito auth) and Phases 3–6.

## Rough cost heads-up (so nothing surprises you)
- The whole AWS target for GlowPT is **~$60–120/month**, well under the **$150/mo budget alarm** already set.
- The moment RDS turns on, a small hourly charge begins (a few dollars a month at the smallest size). That's the "now it costs money" line. Everything before it (the 3 setup steps) is free.

## Settled — no decisions needed at the top of next session
- IaC tool = **AWS CDK (TypeScript)** ✅
- Database schema = **done and tested** ✅
- Auth shape = **Cognito, passwordless email code, clinic-only accounts** ✅ (designed)
- Account/region = **`glowpt-prod` (463556655381), `us-east-1`** everywhere ✅

## One open technical caveat to verify during the build
`db/schema.sql` uses three database roles, one of which needs a special "BYPASSRLS" power. It worked locally. We confirm RDS allows it right after the database is created (before relying on it). Noted so it isn't a surprise.

## Working reminders (for me)
- One step per message; **name account + region before every step**.
- Explain what each thing is *for* before the clicks.
- Don't start the RDS/cost-incurring build tired — it's a fresh-head session.
- Password/installer steps that need the Mac admin password are David's to run.
