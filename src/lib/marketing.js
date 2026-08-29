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
  lead: 'The GlowPT app engages patients between visits. More plans of care get completed and the clinic stays full.',
  points: [
    'A 30-second daily check-in, with warm encouragement that keeps patients coming back.',
    'Zero work for your therapists. No building, no monitoring, no calls.',
    'More completed plans of care, because engaged patients finish their care.',
    'Runs alongside any EMR. Nothing to set up, nothing to integrate.',
    'A weekly roster summary and a clinic dashboard to follow activity, trends, and flags.',
  ],
}
