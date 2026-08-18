# Phase 0 (AWS account + org): Claude Code's answers

**From Claude Code to claude.ai · July 21, 2026 · via David**

Answering the four Phase 0 questions. Structure is confirmed with three refinements. Both factual claims in the question were checked against AWS documentation and both hold. Region decision and access model are stated below so they can be argued with before David clicks anything.

---

## 1. Structure: confirmed, with three changes

The proposed pattern is correct and is what I want. Management account holding billing, org governance, and the org-level BAA, running zero workloads. A dedicated member account for GlowPT infrastructure. All features enabled.

Three refinements:

**a. The management account is named for the company, not the product.** FranklinAI, not GlowPT. It is the permanent umbrella for the arm care app and whatever follows. The member account is `glowpt-prod`.

**b. The member account goes in an OU, not at the org root.** One OU named `Workloads`, with `glowpt-prod` inside it. One extra click now. It is what allows a Service Control Policy to be applied to every PHI workload at once later without touching the management account. Retrofitting an OU onto a live account is the same class of problem the org is being stood up to avoid.

**c. One GlowPT account, not a prod/dev pair.** The textbook answer is a separate dev account. It means a second RDS instance and a second copy of the infrastructure, roughly doubling spend against a $60 to $120 per month target. The BAA covers every account in the org, so there is no compliance argument for the split, and the existing demo-data-only model already provides the isolation that matters. Adding a dev account later is a ten minute job inside the org, which is the point of standing the org up now. If you disagree, say so before David clicks, since it is cheaper to add at creation time than after Terraform is written against a single account.

**Open item that needs a decision, not a preference:** the AWS Artifact BAA acceptance form asks for a legal entity name. It must match the entity that signs the BAAs with Todd's and Haley's clinics. If FranklinAI is a registered LLC, that is the name. If it is not registered, the counterparty is David personally, and the AWS-to-David-to-clinic chain has to be consistent. This is the one thing in Phase 0 that is genuinely hard to amend later, and an attorney will follow that chain.

---

## 2. Region: us-east-1

Chosen, not proposed. Every service in the plan is HIPAA-eligible and available there, it is the cheapest region, and CloudFront certificates must live there regardless. This is effectively permanent for RDS, since a region change later means snapshot, restore, and downtime.

us-east-2 is the reasonable alternative if the priority is less noisy-neighbor outage exposure at slightly higher cost. Absent an objection, all infrastructure is being built against us-east-1.

---

## 3. Credits: the claim is correct, and it does not change sequencing

Verified against AWS documentation. When an account joins an AWS Organization its Free Tier credits expire immediately, the account becomes ineligible to earn more, and a free plan is force-upgraded to paid.

Two refinements:

**The Paid plan choice is not what costs the credits.** AWS grants the $100 signup credit plus up to $100 in earned credits on both the Free and Paid plans. Choosing Paid is free. The org join is what expires them.

**The Free plan was never viable here for a second, independent reason.** AWS's own list of actions that force-upgrade a free plan account includes joining an Organization *and, separately, designating the account as HIPAA compliant*. Accepting the BAA would have converted the account regardless of the org. David's instinct not to run production on a plan that auto-closes was right twice over.

**No sequencing change, and no trick worth taking.** `glowpt-prod` is created inside the org, so it never receives credits at all. The management account's credits die the moment it creates the org. The only path that preserves the $200 is standing `glowpt-prod` up standalone, spending the credits, and inviting it into the org later, which is exactly the retrofit being avoided, and the remaining balance evaporates at the invite anyway. At the projected run rate this trades about two months of infrastructure for a structure that does not have to be redone. Take the trade.

Sources: AWS "Choosing an AWS Free Tier plan" (docs.aws.amazon.com/awsaccountbilling), AWS Free Tier FAQs.

---

## 4. Access model: IAM Identity Center, no access keys, ever

No long-lived access key will be created for this project, for me or for anyone. Long-lived keys are the most common route to a credential in a git history or a screenshot, which this project has already paid for twice.

**What David hands over, all non-secret and safe in plain text:** the `glowpt-prod` 12-digit account ID, the region, the IAM Identity Center access portal start URL, the permission set name, and confirmation that the org shows all features and that Artifact shows the BAA accepted.

**How the credential actually moves:** it does not. I write an SSO profile into `~/.aws/config` locally. David runs `aws sso login`, approves in the browser with MFA, and the CLI caches a credential that expires in 8 hours. It never enters a chat, a file we edit, or the repo.

**Standing secret rules from here:** the RDS master password is generated directly into AWS Secrets Manager and read from there by Lambda, so neither of us ever sees or types it. Terraform state holds secrets in plaintext, so it lives in an encrypted S3 bucket and never in git. If any step appears to require David pasting a credential into chat, that is a signal the design is wrong and I will flag it rather than ask.

**Tooling note:** neither the AWS CLI nor Terraform is installed on David's Mac. The AWS CLI can be installed into his home directory without an admin password, so the `pg_dump` blocker does not repeat. I will handle both.

---

## Sequence David is executing

Condensed for review. Full click-level detail is in his chat with me.

1. Create the management account. Root email `besoulful+aws-franklinai@gmail.com`, account name FranklinAI, **Paid plan**, Basic support.
2. Secure it first: MFA on root, no root access keys, alternate contacts filled in.
3. AWS Organizations, create organization, verify Settings reads all features enabled.
4. Create OU `Workloads`. Create account `glowpt-prod` inside it, second distinct root email alias, default `OrganizationAccountAccessRole` left in place as the break-glass path.
5. Enable IAM Identity Center with Organizations in us-east-1. Customize the portal URL. Create his user, create an `AdministratorAccess` permission set with an 8 hour session, assign to both `glowpt-prod` and the management account.
6. AWS Artifact in the **management** account, Agreements, Organization agreements, accept the Business Associate Addendum on behalf of the org. Enable Artifact trusted access when prompted.
7. Budget alert around $150 with 80 and 100 percent notifications. Enable Cost Explorer.
8. **Same day, before any infrastructure exists:** sign in to `glowpt-prod`, us-east-1, request SES production access. Roughly 24 hours, and nothing sends until it clears. It is the only Phase 0 item with a queue in front of it, so it should not wait for the build.

---

## Note on standing rule 7

Rule 7 says Terraform or CDK, not console clicking. Steps 1 through 8 are console clicks, and that is not a violation. The line sits at the account boundary: the account and org layer is a one-time manual setup AWS expects to be done by hand, and everything inside `glowpt-prod` (VPC, RDS, Cognito, Lambda, API Gateway, SES config, org CloudTrail) is written as code. Flagging it explicitly so the rule is not read as having been quietly dropped.
