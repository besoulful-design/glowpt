// Legal + privacy copy, kept in ONE place so the patient notice, the clinic
// agreement, and the recorded consent version can never drift apart.
//
// WHY A VERSION STRING MATTERS: `consent_version` is written into the `consents`
// table when a patient joins, and it is the only record of WHICH text that
// person actually agreed to. If you materially change PATIENT_PRIVACY_NOTICE
// below, you MUST bump PRIVACY_NOTICE_VERSION in the same commit, or the
// consent rows will claim agreement to words the patient never saw.
//
// v2 -> v3 (2026-08-23): the AI reflection moved from Anthropic's own API to
// Amazon Bedrock, so the notice no longer names Anthropic as a recipient. That
// is a material change to who receives PHI, hence a new version.

export const PRIVACY_NOTICE_VERSION = 'v3'

// Patient-facing privacy notice, shown at /join before the consent checkbox.
// Written to be true of the app as it actually behaves today:
//   - check-ins carry feeling (1-5), movement list, free-text note
//   - the AI reflection sends first name + feeling + movement + note to Anthropic
//     (see PatientApp.jsx prompt construction) and nothing else
//   - the weekly email carries first name + a check-in count, no clinical detail
//   - staff reads are written to access_log; RLS scopes every read to one clinic
// If any of those change, this text changes and the version bumps with it.
export function patientPrivacyNotice(clinicName) {
  const clinic = clinicName || 'your clinic'
  return [
    {
      heading: 'What GlowPT records',
      body: `The check-ins you choose to submit: how you're feeling on a scale of 1 to 5, the movement you did that day, and any note you write. We also store your name and email address so ${clinic} can recognize you and so we can send your sign-in codes.`,
    },
    {
      heading: 'Who can see it',
      body: `Your care team at ${clinic} — your assigned therapist and the practice manager. Every time a staff member opens patient information, that access is recorded. No other clinic using GlowPT can see anything about you.`,
    },
    {
      heading: 'How the daily reflection is written',
      body: `The short message you get back after each check-in is written by an AI model. To write it, we send that one check-in — your first name, your feeling score, your movement, and your note — to Amazon Bedrock, the AI service running inside our own protected Amazon Web Services account. Your email address, your last name, and your history are not sent. Your words never leave that protected environment, are not sent to an outside AI company, and are not used to train anyone's models.`,
    },
    {
      heading: 'The weekly email',
      body: `Once a week we may send you a short encouragement with your first name and the number of check-ins you logged. It never includes your notes, your mood, or any clinical detail. Your clinic separately receives totals only, with no names attached.`,
    },
    {
      heading: 'How it is protected',
      body: `Your information is encrypted while it travels from your phone and encrypted again where it is stored, on Amazon Web Services in the United States. Under HIPAA, GlowPT works for ${clinic} as a business associate, which means we are held by written agreement to the same protection rules your clinic follows.`,
    },
    {
      heading: 'What we never do',
      body: `We do not sell your information. We do not use it for advertising. We do not share it with employers, insurers, or anyone outside your care team at ${clinic}, except where the law requires it.`,
    },
    {
      heading: 'Your choices',
      body: `Your health record belongs to ${clinic}, so requests to see, correct, or delete your information go to them directly, and they can answer questions about how it is handled. You can stop using GlowPT whenever you like — ask ${clinic} to close your account. Choosing not to use GlowPT does not affect the care you receive.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Clinic Business Associate Agreement
// ---------------------------------------------------------------------------
// ⚠️ THE OPERATIVE AGREEMENT IS NOT WRITTEN YET AND MUST NOT BE INVENTED HERE.
//
// A BAA is a binding contract between FranklinAI Solutions LLC and the clinic
// that allocates real HIPAA liability. It needs to come from a reviewed
// template (HHS publishes sample business associate provisions) and be read
// once by an attorney. Drafting plausible-sounding contract language here would
// give a clinic something that LOOKS executable and is not.
//
// WHAT IS SAFE TO SHOW TODAY: an honest plain-language summary of what the
// agreement will cover, clearly labelled as a summary, with the UI asking the
// clinic only to REVIEW it — never to sign. That is what ships below.
//
// TO GO LIVE: set BAA_IS_EXECUTED to true and replace BAA_SUMMARY with the
// real agreement text. The Onboard screen reads both and changes its wording
// from "review" to "agree" on its own — no other edit needed.

export const BAA_IS_EXECUTED = false

export const BAA_VERSION = 'summary-v3'

// Structured the same way as the patient notice so both modals render headings
// and body text identically, and so neither depends on hand-wrapped line breaks
// (a pre-wrapped block broke mid-sentence at narrow widths).
export const BAA_SUMMARY_INTRO =
  'This is a summary of the agreement between your clinic and FranklinAI Solutions LLC, the company behind GlowPT. It is not the agreement itself. You will review and sign the full agreement before any real patient information enters GlowPT.'

export const BAA_SUMMARY = [
  {
    heading: 'What GlowPT is to you',
    body: 'Your clinic is the covered entity under HIPAA. GlowPT is your business associate: we handle protected health information on your behalf, and only to provide this service to you.',
  },
  {
    heading: 'What we may do with patient information',
    body: 'Use it to run GlowPT for your clinic, and nothing else. We will not sell it, use it for advertising, or use it to build products for anyone else.',
  },
  {
    heading: 'How it is protected',
    body: 'Encrypted in transit and encrypted at rest on HIPAA-eligible Amazon Web Services infrastructure, under an executed AWS business associate addendum. Access is restricted to your own clinic\'s records, and every staff read is logged.',
  },
  {
    heading: 'Subcontractors',
    body: 'Any vendor that handles patient information on our behalf is bound by the same obligations in writing. Today that is Amazon Web Services alone — hosting, database, email, and the Bedrock service that runs the AI reflection — all under one executed AWS business associate addendum.',
  },
  {
    heading: 'If something goes wrong',
    body: 'We notify your clinic without unreasonable delay if protected health information is breached, with what we know about what happened and who was affected.',
  },
  {
    heading: 'When the relationship ends',
    body: 'You can export your clinic\'s data. We return or destroy the protected health information we hold, except where the law requires us to keep it.',
  },
  {
    heading: "Your patients' rights",
    body: 'We help you meet your HIPAA obligations to patients who ask to see, correct, or get an accounting of disclosures of their information.',
  },
  {
    heading: 'Which document governs',
    body: 'The signed agreement governs. Where this summary and the signed agreement differ, the signed agreement wins.',
  },
]
