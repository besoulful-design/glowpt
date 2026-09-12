# CLAUDE.md trim — plan, progress and handoff

**Started 2026-09-12 ~09:00 by David's instruction. If a thread died mid-way, READ THIS
FIRST, check the Progress box below, and continue from the first unchecked step.**

---

## Why

`CLAUDE.md` reached **478 KB / ~135,000 tokens** and is loaded in full at the start of
every session, so every thread began ~14% full before any work. It had quadrupled in
11 days (33 KB on Aug 1 → 478 KB on Sep 12) and was on track to crowd out a whole
context window within weeks. David: *"I'll eventually need a new thread for every
prompt if I don't do something."*

**Root cause, and it is Claude's doing, not David's:** CLAUDE.md is meant to hold
project *conventions* — small, stable, always relevant. It had become a
session-by-session *journal*. 61% of it (289 KB) was "Status & backlog", a narrative of
every fix since July. The doc instructed each session to write exhaustively, so each one
did; a loop that only grows.

## The decision (David approved 2026-09-12)

**Distil, then archive — not just split.** A plain split halves the file and it regrows
at the same rate. Almost every backlog entry is one durable rule wrapped in several
hundred words of story. Keep the rule, archive the story.

**David's one constraint: KEEP THE LAST TWO WEEKS INTACT.** Cutoff is **2026-08-29**.
Entries dated 08-29 or later stay in CLAUDE.md in full.

## ⚠️ The risk, stated up front

A pure date cutoff would archive entries that are still load-bearing rules, not history:
the house COPY RULE (#86), inline links must be a `<span>` (#87), the sandbox-separate-
from-Riverside convention (#88), the brand one-declaration rules (#81/#82/#84), how to
actually look at UI changes (#111), the modal hook (#92), Fraunces `fontStyle` (#96),
the activation gate architecture (#101), the contractual PRICE_LINE (#100).

**So the trim has two halves and BOTH are required:**
1. Archive the narrative older than 2026-08-29.
2. Lift the durable rules out of what is archived into a distilled **RULES** section in
   CLAUDE.md, one or two lines each.

Losing half 2 is how this goes wrong. Nothing is deleted either way — the full text
lives in `docs/history.md`.

## Plan

- [x] 0. Write this note and commit it, so a dead thread loses nothing
- [x] 1. Create `docs/history.md` with the FULL current Status & backlog + the old
      "Previously updated" header chain, verbatim
- [x] 2. Distil durable rules from pre-08-29 entries into a RULES section in CLAUDE.md
- [x] 3. Trim CLAUDE.md: keep sections 1-4 (with the header chain cut to ~2 weeks),
      keep backlog entries dated 2026-08-29+, drop the rest (now in history.md)
- [x] 4. Archive the superseded Bedrock investigation history (it is explicitly marked
      `[HISTORICAL]` / `superseded` in the doc and runs ~26 KB)
- [x] 5. Add a "what may be added to this file" rule at the top, so it cannot regrow
- [x] 6. Verify: every archived byte is present in history.md; measure before/after
- [ ] 7. Commit + push; show David the result

## Progress log

- 2026-09-12 09:00 — plan written and committed.
- 2026-09-12 09:40 — steps 1-6 done. CLAUDE.md **473 KB -> 332 KB**, ~134,500 -> ~94,300
  tokens. `docs/history.md` (156 KB) holds everything removed, verbatim.
  - **⚠️ One real loss caught by the verification and restored: the RDS runbook and the
    DB secret name** lived inside the archived migration log. That name cannot be looked
    up at runtime (`list-secrets` is classifier-blocked), so losing it would have cost a
    session. It is back in CLAUDE.md under "Live infrastructure and the DB runbook".
    **A verification pass that only checks "is it in the archive" is not enough — also
    check that live operational facts did not leave with the history around them.**
- 2026-09-12 09:45 — step 7: committed and pushed.

## Result, and the honest shortfall

**478 -> 332 KB. ~135,000 -> ~94,300 tokens.** A thread now starts at ~9% of the window
instead of ~14%.

**⚠️ THAT IS LESS THAN IT SHOULD BE, AND DAVID SHOULD DECIDE THE NEXT STEP.** Keeping the
last two weeks byte-intact was his instruction and it was followed — but **those two
weeks ARE the bulk**: 82 entries, **224 KB**, because 2026-09-04 to 09-12 was an
extremely busy stretch. Everything else in the file now totals ~108 KB.

So the remaining choice, with real numbers:
- **Leave it.** 332 KB. Buys a few weeks before the same conversation recurs.
- **Condense the two-week entries too** — keep every entry, cut each to its rule, what
  broke, and the verification line, dropping the investigation narrative (which is in the
  commit messages anyway). 82 entries averaging 2.7 KB would land near 35 KB, taking the
  file to roughly **140 KB / ~40,000 tokens**. That buys months.

**Not done, because it was not what David approved.** Put it to him.


---

# PHASE 2 — condensing the last two weeks (David approved 2026-09-12)

David: *"yes go ahead and condense the two weeks too."*

**Status: IN PROGRESS.** If a thread died here, check `git log` — if the commit
"CLAUDE.md: condense the last two weeks" exists, phase 2 is done.

**Done first, so nothing can be lost:** the FULL original text of all 82 post-08-29
entries is now in `docs/history.md` section 10, verbatim.

**Method:** 53 entries are >=1.5 KB (196 KB total) and get condensed to roughly
400-700 bytes each — the headline, what broke, the durable rule, and what was observed.
The investigation narrative goes (it is in history.md and in the commit messages).
The 29 entries under 1.5 KB (28 KB) are already short and are left alone.

**⛔ WHAT MUST SURVIVE CONDENSING:** every ⛔ and ⚠️ rule, every live id/number/threshold,
every "do not put this back" warning. Those are the lines that have actually saved
sessions. If in doubt, keep the rule and drop the story around it.
