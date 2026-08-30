// The one place the public pitch lives: price, contact, and the "what is this"
// copy behind the landing page's More Info modal.
//
// Kept in one file for the same reason as lib/feelings.js and lib/legal.js —
// the price now appears in two places (the modal and the /onboard form), and a
// price that disagrees with itself is worse than a price shown once.
//
// The wording deliberately mirrors the GlowPT card + modal on the FranklinAI
// site, so a buyer arriving from there reads one story, not two.

export const CONTACT_EMAIL = 'david@franklinaisolutions.com'

// Subscription-Agreement §5.1 states this figure and also refers to "the
// amount stated at sign-up" — so this constant IS that statement. Change it
// here and both surfaces follow.
export const MONTHLY_PRICE_USD = 350
export const PRICE_LINE = `$${MONTHLY_PRICE_USD} per month, per clinic. Patients join free.`

export const whatGlowptIs = {
  lead: 'The GlowPT app engages patients between visits. More completed plans of care and the clinic stays full.',
  // These 8 bullets are word-identical AND in the same order as the GlowPT
  // modal on the FranklinAI site (franklinai-v2/src/App.jsx, `features`).
  // David's call 2026-08-30: the two lists must match exactly, so a buyer who
  // reads both surfaces never sees the product described two different ways.
  // Change one list, change the other.
  points: [
    'A 30-second daily check-in, with warm encouragement that keeps patients coming back.',
    'A private journal and weekly streaks, in every patient\'s pocket.',
    'One subscription covers the clinic and all its patients for free.',
    'Reaches every patient, not just the ones you can bill remote monitoring on.',
    'More completed plans of care, because engaged patients finish their care.',
    'Zero work for your therapists. No building, no monitoring, no calls.',
    'Runs alongside any EMR. Nothing to set up, nothing to integrate.',
    'A weekly roster summary and a clinic dashboard to follow activity, trends, and flags.',
  ],
}
