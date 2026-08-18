# GlowPT — Supabase Surface Inventory

**Brief for Claude Code · July 17, 2026**

---

## Read This First

**This task produces one document. It changes no code.**

Do not migrate anything. Do not refactor. Do not "improve" anything you find. Do not create, modify, or delete a single application file. The only file you write is the output document named at the bottom of this brief.

If you spot a bug, a security problem, or an obvious improvement, **write it in the Observations section and leave it alone.** Fixing things is a separate conversation with David.

---

## Why This Exists

GlowPT is moving off Supabase to AWS. The database schema ports cleanly. The rest does not, because Supabase bundles several products that AWS does not:

| Supabase today | AWS equivalent | Rebuild cost |
|---|---|---|
| Postgres | RDS Postgres | Low. Schema ports. |
| PostgREST (`supabase.from(...)`) | **Nothing. Doesn't exist.** | One Lambda + API Gateway route per call site. |
| RLS via `auth.uid()` | Native Postgres RLS, different plumbing | Policies port; the identity injection is rebuilt. |
| Supabase Auth | Cognito | Every auth flow rewritten. |
| Supabase Storage | S3 + presigned URLs | Objects move, access pattern rewritten. |
| Edge Functions (Deno) | Lambda (Node) | Ported per function. |
| Realtime | **Nothing built-in.** | Unknown until we know if it's used. |

The migration is sized almost entirely by **the number of `supabase.*` call sites** and **whether Realtime is in use**. Nobody currently knows either number. This inventory produces them.

**Target: real patients in the system in roughly two weeks.** That date is David's own and is not promised to anyone, so it can move. It moves based on what this document says, which is why the document has to be accurate rather than optimistic.

**No PHI is in the system yet.** Demo clinics only. That means no data migration, and it means the window for the cheap version of this move is open right now and closes the moment a real patient logs in.

---

## What to Produce

Work through the GlowPT repository and report the following. **Counts matter more than prose.** Put a hard number on everything countable.

### 1. Headline numbers

Put these at the very top, in a table, so the arithmetic is visible on the first screen:

- Total `supabase.*` call sites
- Distinct tables
- Distinct storage buckets
- Realtime subscriptions (a zero here is very good news; say so)
- Edge Functions
- Auth flows in use

### 2. Tables and RLS

For every table:

- Name, and roughly what it holds
- **Whether RLS is enabled** (call out any table where it isn't — that's a finding)
- Every policy on it: name, command (SELECT/INSERT/UPDATE/DELETE), and the `USING` / `WITH CHECK` expression verbatim
- Flag every policy that references `auth.uid()`, `auth.jwt()`, or `auth.role()`. These are the ones whose plumbing gets rebuilt.
- Which tables hold or will hold PHI

Quote the policy expressions exactly. They're the highest-value thing in this document, because they port nearly as-is and they're the security model.

### 3. Every `supabase.*` call site

Grouped by file, in a table: file path, line number, the call, and the table or bucket it touches.

Then classify each one:

- **Simple** — a straightforward read or write on one table
- **Complex** — joins, RPC calls, transactions, chained filters, anything with `.rpc(`

This split is the actual estimate. Simple call sites are mechanical. Complex ones are where the days go.

### 4. Storage

- Every bucket, public or private
- What's in it, and whether any of it is or will be PHI
- Which access pattern each use is: direct URL, signed URL, upload, download
- Any RLS/storage policies on buckets, quoted

### 5. Realtime

- Any `.channel(`, `.on(`, `.subscribe(` usage
- If none: **say so explicitly.** A clean zero here removes the single biggest unknown in the plan.

### 6. Auth

- Every flow in use: signup, login, logout, password reset, magic link, invite, email confirmation, session refresh
- Where user roles live (JWT claim, a table, `raw_user_meta_data`, app logic)
- How the frontend gets and holds the session
- Anything reading `auth.users` directly

### 7. Edge Functions

For each: name, what it does, what it calls out to, whether it touches PHI, and whether it needs outbound internet access. Note the AI reroute function specifically.

### 8. Config surface

- Every env var and where it's consumed
- Where the anon key and the service role key are each used
- **Flag any service role key reachable from client-side code.** That's a finding, not a note.

### 9. Frontend third-party scripts

Every `<script>` tag, analytics package, or error tracker running on a page that will handle PHI. Each of these vendors would be a business associate. List them. Don't judge them.

### 10. Observations

Anything that worried you. Especially:

- Identifiers appearing in URL paths or query strings (these get logged by Netlify's CDN and would put PHI somewhere it must not be)
- Tables with RLS off
- Authorization enforced only in application code rather than in a policy
- Anything that would break under Lambda's connection model

Report. Don't fix.

---

## Output

Write to `glowpt-supabase-inventory.md` at the repo root.

Structure it exactly as the sections above, headline numbers first.

**Do not commit it.** Leave it for David to read.

---

## Reminders

- **You are reading, not writing.** One output file, no application changes.
- Read the actual files. Don't infer from folder names or from what a schema implies.
- If something is ambiguous, write down the ambiguity. A documented unknown is useful. A confident guess is worse than useless, because this document is the input to a decision about whether a two-week timeline is real.
- No em dashes in the output.
