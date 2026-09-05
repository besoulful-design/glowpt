import { useState } from 'react'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'

// Shown to a signed-in patient who isn't attached to any clinic.
// Without this gate they'd drop straight into the daily check-in and every entry
// would save with clinic_id = null — invisible to every clinic dashboard. A patient
// gets attached to a clinic by using that clinic's join link / QR code (/join/<slug>).
export default function NoClinic() {
  const { user, signOut, attachError, refreshProfile } = useAuth()
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    setRetrying(true)
    try { await refreshProfile() } finally { setRetrying(false) }
  }

  // Two genuinely different situations, and telling them apart matters.
  //
  // A plain no-clinic account has simply never used a join link, and the
  // original copy below is right for them.
  //
  // But if an attach was ATTEMPTED and FAILED, that same copy is actively
  // misleading: an invited patient HAS followed their link, and sending them
  // off to find another one is advice they cannot act on. Until 2026-09-05 the
  // failure was a console.log, so everyone saw the first message and a real
  // patient was stranded with nothing to go on.
  if (attachError) {
    return (
      <AuthShell>
        <LogoMark size={140} />
        <div style={ui.title}>We couldn’t finish connecting you.</div>
        <div style={ui.muted}>
          You’re signed in{user?.email ? ` as ${user.email}` : ''}, but something went wrong while
          linking you to your clinic, so your check-ins have nowhere to go yet. Trying again often
          sorts it.
        </div>
        <button style={ui.btn} onClick={retry} disabled={retrying}>
          {retrying ? 'Trying…' : 'Try Again'}
        </button>
        <div style={ui.fine}>
          Still stuck? Ask your clinic to send your invite again, then open the new link.
        </div>
        <button
          type="button"
          onClick={signOut}
          style={{ ...ui.fine, background: 'none', border: 'none', cursor: 'pointer',
                   textDecoration: 'underline', marginTop: 10 }}
        >
          Sign Out
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <LogoMark size={140} />
      <div style={ui.title}>You’re not connected to a clinic yet.</div>
      <div style={ui.muted}>
        Your account is ready{user?.email ? ` for ${user.email}` : ''}, but it isn’t linked to a clinic,
        so there’s nowhere for your check-ins to go. Open the join link or scan the QR code your
        clinic gave you, and you’ll be all set.
      </div>
      <button style={ui.btn} onClick={signOut}>Sign Out</button>
      <div style={ui.fine}>Already have your clinic’s link? Open it and sign in with this same email.</div>
    </AuthShell>
  )
}
