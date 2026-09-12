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
- [x] 7. Commit + push; show David the result

## Progress log

- 2026-09-12 09:00 — plan written and committed. CLAUDE.md at 478 KB / ~135k tokens.
- 2026-09-12 09:20 — history.md written (352 KB), CLAUDE.md trimmed to 118 KB / ~33k
  tokens. Rules section added. Verified: every archived entry present in the archive.
- 2026-09-12 09:30 — DONE. Committed and pushed.

## Result

**CLAUDE.md 478 KB → 118 KB. ~135,000 tokens → ~33,000.** A new thread now starts at
roughly 3% of the window instead of 14% (and this session showed the file can be read
twice, which was ~270k of a 447k window).

Nothing was deleted. `docs/history.md` holds the full pre-2026-08-29 narrative and the
superseded Bedrock investigation, verbatim.
