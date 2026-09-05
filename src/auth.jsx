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
const PENDING_PATIENT_INVITE_KEY = 'glowpt.pendingPatientInvite' // { token, consentVersion }

export function savePendingJoin(slug, fullName, consentVersion) {
  localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ slug, fullName, consentVersion }))
}

export function savePendingStaff(token) {
  localStorage.setItem(PENDING_STAFF_KEY, token)
}

export function savePendingPatientInvite(token, consentVersion) {
  localStorage.setItem(PENDING_PATIENT_INVITE_KEY, JSON.stringify({ token, consentVersion }))
}

export function savePendingOnboard(clinicName, slug, fullName) {
  localStorage.setItem(PENDING_ONBOARD_KEY, JSON.stringify({ clinicName, slug, fullName }))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)      // { id (sub), email } or null
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Set when a clinic attach was ATTEMPTED and failed, so NoClinic can say
  // something true instead of "open your clinic's join link", which is wrong
  // advice for an invited patient and impossible to act on. Before 2026-09-05
  // this was a console.log and nothing else, which is how a real patient got
  // stranded with no way for anyone to tell why.
  const [attachError, setAttachError] = useState(null)

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
      const patInviteRaw = localStorage.getItem(PENDING_PATIENT_INVITE_KEY)

      // ⚠️ These keys are cleared AFTER a successful attach, not before the
      // attempt. Clearing first meant one bad moment (a network blip, or the
      // missing-identity-row bug) threw away the only record of which invite
      // the person was claiming, so reloading could never recover it.
      try {
        if (onboardRaw) {
          const o = JSON.parse(onboardRaw)
          await api.provisionClinic(o.clinicName, o.slug)
          if (o.fullName) await api.updateMe(o.fullName)
        } else if (patInviteRaw) {
          // An invited patient. Carries its own consent version, because this
          // path writes a consents row and the staff path never does.
          const pi = JSON.parse(patInviteRaw)
          await api.acceptPatientInvite(pi.token, pi.consentVersion || null)
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
        setAttachError(null)
      } catch (err) {
        console.log('Profile re-attach failed:', err.message)
        setAttachError(err.message || 'unknown')
      }

      try {
        prof = await api.getMe()
      } catch (err) {
        if (err.status !== 404) throw err
      }
    }

    // Attached (by the Lambda or by the re-attach above): drop every pending key
    // so none can re-fire a stale attach, and clear any earlier failure.
    if (prof?.clinic_id) {
      localStorage.removeItem(PENDING_ONBOARD_KEY)
      localStorage.removeItem(PENDING_JOIN_KEY)
      localStorage.removeItem(PENDING_STAFF_KEY)
      localStorage.removeItem(PENDING_PATIENT_INVITE_KEY)
      setAttachError(null)
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
    setAttachError(null)
  }

  async function refreshProfile() {
    if (user) await loadProfile()
  }

  // `session` is kept as a truthy convenience mirror of `user` so existing screens
  // that check `session` keep working without change.
  const value = { session: user, user, profile, loading, attachError, onSignedIn, signOut, refreshProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
