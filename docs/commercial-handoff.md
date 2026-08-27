# GlowPT — commercial & marketing state (handoff)

*Written 2026-08-27, for the FranklinAI marketing-site project. Assembled from
`CLAUDE.md`, `src/lib/marketing.js`, `src/screens/Onboard.jsx`,
`src/screens/Dashboard.jsx`, and the two legal drafts in `legal/` — not from
memory. If this file and the code ever disagree, the code wins.*

## Price — SETTLED, do not reopen

- **$350/month, per clinic. Patients join free.**
- Decided 2026-08-24. One price. No range, no "starting at", no blended figure.
  The old "~$300 blended / $250–350 planning range" wording is retired.
- Single source of truth: `src/lib/marketing.js` → `MONTHLY_PRICE_USD = 350`,
  rendered as `PRICE_LINE`: "$350 per month, per clinic. Patients join free."
- Year-1 target: 29–40 clinics → $100–140K ARR ($120K goal).

## Where the price appears (only two places in the product)

1. Landing page → **More Info** modal (glowpt.app).
2. `/onboard`, directly above the BAA consent checkbox.

⚠️ #2 is a **contract requirement, not decoration.** Subscription Agreement §5.1
says "the subscription fee of $350 per month, **or the amount stated at sign-up**."
That on-screen line IS the "amount stated at sign-up." Don't remove it. If the
price changes, change the constant — both surfaces derive from it.

## Payments — nothing exists yet

- **There is no billing in the product at all.** Zero Stripe, zero payment
  method capture, zero invoicing. Verified by grep.
- A clinic can sign up, get its QR code, and start inviting patients without
  ever paying anything. Collection is manual/offline today.
- Stripe subscriptions are on the backlog, unstarted.
- What the contract *says* (drafted, not built): billed **monthly in advance**,
  non-refundable, month-to-month, auto-renews, cancel anytime effective end of
  the current month, no pro-rating. Suspension after failed payment.
- ⚠️ Counsel is asked about **state auto-renewal statutes** — real unaddressed
  exposure for a product sold across state lines. Relevant if the marketing site
  makes renewal or cancellation claims; don't promise terms ahead of that answer.

## Self-serve — signup is self-serve, activation is NOT

This is the most important thing for marketing to get right.

- `/onboard` is a fully self-serve web form. ~4 fields, no human in the loop,
  no sales call required to create a clinic.
- **BUT a new clinic starts CLOSED.** As of 2026-08-26 there is a per-clinic
  activation gate enforced in the database: a closed clinic cannot enrol a
  patient and cannot accept a check-in, no matter what any UI does.
- David switches it on manually at `/admin`. That flip is the **only human step
  left in the flow**, and it is deliberately the moment the BAA and the first
  payment get confirmed. "Record BAA Signed" and "Switch On" are separate buttons.
- So the honest description is: **self-serve sign-up, manually activated.**
  Marketing can say "set up your clinic in a minute" — it should NOT imply
  patients can start checking in immediately after signup.
- What a manager sees on a closed clinic (live copy):
  > Your clinic isn't switched on yet. Patients can't join or check in until it
  > is. We'll switch it on once the Business Associate Agreement is signed —
  > email david@franklinaisolutions.com to get that started.

## Discovery call — NO RECORD

Nothing about a discovery call exists in the GlowPT repo, project doc, or either
contract. The only human touchpoint currently designed is the activation email
above. If a discovery-call step was decided elsewhere, it needs reconciling with
the activation gate, since that is where such a call would naturally slot in.

## Contact — one hard rule

- Contact address is **david@franklinaisolutions.com** everywhere (landing modal,
  dashboard banners).
- ⚠️ **Never put an @glowpt.app address in a mailto.** glowpt.app has NO root MX
  record — nothing can receive mail there. `hello@glowpt.app` was only ever a
  *sending* From label. A mailto to it bounces silently.
  (The root MX is still free if Google Workspace on glowpt.app is ever wanted.)

## Positioning (must match on both sites)

- GlowPT is **NOT an HEP/exercise-program tool** — clinics resist those. The wedge
  is the daily emotional/adherence check-in no other clinic tool owns.
- Buyers: clinic owners + office/practice managers. Often on Instagram, not LinkedIn.
- Economic argument: 65–70% industry dropout before the plan of care completes;
  GlowPT keeps patients engaged between visits → completed care → clinic stays full.
- Tagline: "One good day at a time."

## Live glowpt.app copy (as of 2026-08-27)

- **Header (changed 2026-08-27):** "A daily check-in app for patients to stay
  engaged between visits to help complete plans of care."
  One sentence, no sub-line. Deliberately self-sufficient — glowpt.app is reached
  by direct URL, search, QR and clinic forwards, not only from the FranklinAI site,
  so it cannot assume the FranklinAI card was read.
- **More Info modal lead:** "Patients walk out doing great, then drift off before
  their plan of care is done. GlowPT keeps them engaged between visits, so more
  plans of care get completed and the clinic stays full."
- **5 bullets:** 30-second daily check-in · Zero work for your therapists ·
  More completed plans of care · Runs alongside any EMR · Weekly roster summary
  and clinic dashboard.

## GlowPT site vs FranklinAI site — the known deltas

- The modal is deliberately a **subset** of the FranklinAI GlowPT card: it keeps
  5 of the 8 bullets. Three were cut on purpose — the patient-facing
  journal/streaks one, the "one subscription covers the clinic" one (its content
  became the price line), and the **remote-monitoring (RTM) billing** one, which
  is strong for owners who know RTM but needs explaining.
- "Zero work for your therapists" now appears in **both** places (it was missing
  from glowpt.app until recently).
- The FranklinAI card/modal is the fuller pitch; glowpt.app is the short version
  plus the price plus the sign-up path.

## Constraints that limit what marketing may claim

- **Demo-data-only until the clinic BAA is attorney-reviewed and signed.** No real
  patient data yet. Don't publish claims implying live clinics are in production.
- Two contracts are drafted and awaiting one attorney sitting: the BAA (HIPAA) and
  the Subscription Agreement (commercial). Both are marked
  `DRAFT — NOT FOR EXECUTION`.
- Undecided and marketing-relevant: **click-through acceptance vs signature.**
  If signature wins, self-serve onboarding gains a manual step and the site copy
  has to reflect that.
- Backlog, gated on counsel: a **downloadable dated PDF** of exactly what the
  clinic accepted (clinics generally need the executed BAA in their own compliance
  records). Worth mentioning as a trust signal once it exists — not before.
