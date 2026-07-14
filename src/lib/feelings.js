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
