import { useAuth } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'

// Shown to a signed-in patient who isn't attached to any clinic.
// Without this gate they'd drop straight into the daily check-in and every entry
// would save with clinic_id = null — invisible to every clinic dashboard. A patient
// gets attached to a clinic by using that clinic's join link / QR code (/join/<slug>).
export default function NoClinic() {
  const { user, signOut } = useAuth()
  return (
    <AuthShell>
      <LogoMark size={200} />
      <div style={ui.title}>You’re not connected to a clinic yet</div>
      <div style={ui.muted}>
        Your account is ready{user?.email ? ` for ${user.email}` : ''}, but it isn’t linked to a clinic —
        so there’s nowhere for your check-ins to go. Open the join link or scan the QR code your
        clinic gave you, and you’ll be all set.
      </div>
      <button style={ui.btn} onClick={signOut}>Sign out</button>
      <div style={ui.fine}>Already have your clinic’s link? Open it and sign in with this same email.</div>
    </AuthShell>
  )
}
