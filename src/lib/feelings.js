// The 1–5 feeling scale a patient taps during their daily check-in.
// ONE master list, imported by BOTH the patient app and the clinic dashboard,
// so the face + word a patient chooses is the exact same thing their therapist
// and manager see. Change it here and it changes everywhere — they can't drift.
export const FEELINGS = {
  1: { emoji: '😔', word: 'Really tough' },
  2: { emoji: '😕', word: 'Hard day' },
  3: { emoji: '🙂', word: 'Getting there' },
  4: { emoji: '😊', word: 'Good day' },
  5: { emoji: '😄', word: 'Feeling great' },
}

// A rating is an integer 1–5 and nothing else. This is the ONE definition of
// that, because FEELINGS is indexed by it directly: anything off the scale is
// `undefined`, and reading `.word` off undefined takes down whichever screen
// did the lookup.
//
// ⚠️ IT HAS ALREADY HAPPENED. On 2026-09-05 a check-in was stored with
// feeling 0 — the API's `Number(b.feeling)` turns a missing rating into 0 and
// `Number.isInteger(0)` is true, so the guard meant to reject it passed it.
// 0 is not null, so the dashboard's `avg != null` test let it through to
// FEELINGS[0], and every manager and therapist in that clinic got a blank
// screen. Filter with this rather than testing `!= null` or `typeof === 'number'`.
export const isFeeling = f => Number.isInteger(f) && f >= 1 && f <= 5
