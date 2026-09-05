// House voice enforcement for text this app did not write.
//
// ⚠️ WHY THIS EXISTS. The em-dash ban (2026-08-27) governs everything a patient
// reads, and the daily reflection is written by a model, so no amount of
// hand-editing static strings reaches it. The prompt has been told twice now:
// first "do not use em dashes", which the model satisfied with a spaced hyphen
// and an en dash (2026-09-04), then "never join two clauses with a dash of any
// kind". On 2026-09-05 a real patient's reflection still ended:
//
//     "...what your body needs each day—you're doing great."
//
// THE LESSON: an instruction is a request, not a guarantee. A rule that must
// always hold has to be enforced by something deterministic. The prompt
// instruction STAYS, because a model that complies produces better sentences
// than one that is corrected after the fact; this is the backstop for when it
// does not.
//
// Applied on the way IN (so the saved text is clean for the journal, the
// clinician and any later export) and on the way OUT when reading old rows, so
// entries written before this existed read correctly too.

// A dash joining clauses becomes a comma. Hyphens INSIDE words are untouched,
// so "check-in" and "30-second" survive: only a dash with whitespace around it,
// or an em/en dash anywhere, is a clause joiner.
export function stripClauseDashes(text) {
  if (typeof text !== 'string' || !text) return text
  return text
    .replace(/\s*[—–]\s*/g, ', ')   // em and en dash, spaced or not
    .replace(/\s+-\s+/g, ', ')      // a spaced hyphen doing the same job
    .replace(/,\s*,/g, ',')         // never double up if one was already there
    .replace(/\s+([,.!?])/g, '$1')  // no space before punctuation
    .replace(/[ \t]{2,}/g, ' ')
}
