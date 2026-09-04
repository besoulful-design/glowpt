import { createContext, useContext, useEffect, useState } from 'react'
import * as cognito from './lib/cognito'
import * as api from './lib/api'

// Auth + profile context for GlowPT (AWS stack).
// - Tracks the Cognito session (ID token in localStorage, read via lib/cognito).
// - Loads the user's profile row from GET /me (RLS scopes it to them).
// - Runs the idempotent clinic re-attach safety net if the post-confirmation
//   Lambda ever missed (normally it has already attached the clinic on confirm).

const AuthContext = createContext(null)

const PENDING_JOIN_KEY = 'glowpt.pendingJoin'       // patient: { slug, fullName, consentVersion }
const PENDING_ONBOARD_KEY = 'glowpt.pendingOnboard' // clinic: { clinicName, slug, fullName }
const PENDING_STAFF_KEY = 'glowpt.pendingStaff'     // staff: the invite token

export function savePendingJoin(slug, fullName, consentVersion) {
  localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ slug, fullName, consentVersion }))
}

export function savePendingStaff(token) {
  localStorage.setItem(PENDING_STAFF_KEY, token)
}

export function savePendingOnboard(clinicName, slug, fullName) {
  localStorage.setItem(PENDING_ONBOARD_KEY, JSON.stringify({ clinicName, slug, fullName }))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)      // { id (sub), email } or null
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load the profile, finishing a pending attach if the post-confirmation Lambda
  // missed it. The RPCs are idempotent, so re-running is always safe.
  async function loadProfile() {
    let prof = null
    try {
      prof = await api.getMe()
    } catch (err) {
      if (err.status !== 404) throw err // 404 = no profile row yet (total post-confirm miss)
    }

    // Attached already? Done. Otherwise try the frontend re-attach safety net.
    if (!prof?.clinic_id) {
      const onboardRaw = localStorage.getItem(PENDING_ONBOARD_KEY)
      const joinRaw = localStorage.getItem(PENDING_JOIN_KEY)
      const staffToken = localStorage.getItem(PENDING_STAFF_KEY)
      localStorage.removeItem(PENDING_ONBOARD_KEY)
      localStorage.removeItem(PENDING_JOIN_KEY)
      localStorage.removeItem(PENDING_STAFF_KEY)

      try {
        if (onboardRaw) {
          const o = JSON.parse(onboardRaw)
          await api.provisionClinic(o.clinicName, o.slug)
          if (o.fullName) await api.updateMe(o.fullName)
        } else if (joinRaw) {
          const j = JSON.parse(joinRaw)
          // join_clinic upserts the profile (role pinned to patient) + records consent.
          await api.joinClinic(j.slug, j.fullName || null, j.consentVersion || null)
        } else {
          // Invited staff. With a token this is a retry of the link they
          // followed; without one it is the blind email-matched net, which
          // simply returns null for the many users who have no invite at all.
          await api.acceptStaffInvite(staffToken)
        }
      } catch (err) {
        console.log('Profile re-attach failed:', err.message)
      }

      try {
        prof = await api.getMe()
      } catch (err) {
        if (err.status !== 404) throw err
      }
    }

    // Once the clinic is attached (whether by the Lambda or the re-attach above),
    // drop any lingering pending keys so they can never re-fire a stale attach.
    if (prof?.clinic_id) {
      localStorage.removeItem(PENDING_ONBOARD_KEY)
      localStorage.removeItem(PENDING_JOIN_KEY)
    }

    setProfile(prof || null)
  }

  // On mount, restore any existing session and load the profile.
  useEffect(() => {
    let active = true
    ;(async () => {
      const u = cognito.currentUser()
      if (u) {
        setUser(u)
        try { await loadProfile() } catch (err) { console.log('loadProfile error:', err.message) }
      }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [])

  // Called by the code-verify screen right after a successful sign-in.
  async function onSignedIn() {
    setLoading(true)
    const u = cognito.currentUser()
    setUser(u)
    if (u) {
      try { await loadProfile() } catch (err) { console.log('loadProfile error:', err.message) }
    }
    setLoading(false)
  }

  function signOut() {
    cognito.signOut()
    setUser(null)
    setProfile(null)
  }

  async function refreshProfile() {
    if (user) await loadProfile()
  }

  // `session` is kept as a truthy convenience mirror of `user` so existing screens
  // that check `session` keep working without change.
  const value = { session: user, user, profile, loading, onSignedIn, signOut, refreshProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
