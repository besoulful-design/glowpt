import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Auth + profile context for GlowPT.
// - Tracks the Supabase magic-link session.
// - Loads the user's profile row (clinic_id, role, full_name).
// - Completes a pending clinic "join" after the magic link brings the user back.

const AuthContext = createContext(null)

const PENDING_JOIN_KEY = 'glowpt.pendingJoin'       // patient: { slug, fullName, consentVersion }
const PENDING_ONBOARD_KEY = 'glowpt.pendingOnboard' // clinic: { clinicName, slug, fullName }

export function savePendingJoin(slug, fullName, consentVersion) {
  localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ slug, fullName, consentVersion }))
}

export function savePendingOnboard(clinicName, slug, fullName) {
  localStorage.setItem(PENDING_ONBOARD_KEY, JSON.stringify({ clinicName, slug, fullName }))
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load (and if needed, finish setting up) the profile for a signed-in user.
  // `user` is the full auth user (we read user_metadata, which travels with the
  // account across any browser/device — unlike localStorage).
  async function loadProfile(user) {
    const userId = user.id
    const meta = user.user_metadata || {}
    const COLS = 'id, clinic_id, role, full_name, therapist_id'

    // Load the current profile.
    let prof = (await supabase.from('profiles').select(COLS).eq('id', userId).single()).data

    // If not yet attached to a clinic, finish a pending ONBOARD or JOIN.
    // Guarded by !clinic_id so it runs only once (prevents duplicate clinics on re-login).
    if (!prof?.clinic_id) {
      // Onboard details — signup metadata first, localStorage fallback.
      let obName = meta.onboard_clinic_name
      let obSlug = meta.onboard_clinic_slug
      const onboardRaw = localStorage.getItem(PENDING_ONBOARD_KEY)
      if (!obSlug && onboardRaw) {
        try { const o = JSON.parse(onboardRaw); obName = o.clinicName; obSlug = o.slug } catch { /* ignore */ }
      }
      localStorage.removeItem(PENDING_ONBOARD_KEY)

      // Join details — signup metadata first, localStorage fallback.
      let joinSlug = meta.clinic_slug
      let joinConsent = meta.consent_version
      const pendingRaw = localStorage.getItem(PENDING_JOIN_KEY)
      if (!joinSlug && pendingRaw) {
        try { const p = JSON.parse(pendingRaw); joinSlug = p.slug; joinConsent = p.consentVersion } catch { /* ignore */ }
      }
      localStorage.removeItem(PENDING_JOIN_KEY)

      const name = meta.full_name || prof?.full_name || null

      try {
        if (obSlug && obName) {
          // Clinic onboarding: create the clinic; this user becomes its manager.
          const { error } = await supabase.rpc('provision_clinic', { p_name: obName, p_slug: obSlug })
          if (error) console.log('provision_clinic error:', error.message)
          if (name) await supabase.from('profiles').update({ full_name: name }).eq('id', userId)
        } else if (joinSlug) {
          // Patient join: attach to an existing clinic + record HIPAA consent.
          const { data: clinic } = await supabase.from('clinics').select('id').eq('slug', joinSlug).single()
          if (clinic) {
            await supabase.from('profiles').upsert(
              { id: userId, clinic_id: clinic.id, role: 'patient', full_name: name },
              { onConflict: 'id' },
            )
            if (joinConsent) {
              await supabase.from('consents').insert({
                user_id: userId, clinic_id: clinic.id, type: 'hipaa_patient_ack', version: joinConsent,
              })
            }
          }
        }
      } catch (err) {
        console.log('Profile setup failed:', err.message)
      }

      prof = (await supabase.from('profiles').select(COLS).eq('id', userId).single()).data || prof
    }

    setProfile(prof || null)
  }

  useEffect(() => {
    let active = true

    // onAuthStateChange fires an INITIAL_SESSION event on mount, so it covers both
    // the existing session and future sign-in/out. We defer profile loading with
    // setTimeout(…, 0) so our Supabase queries do NOT run inside the auth callback's
    // lock — doing so can deadlock and hang the app forever on "Loading…".
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setSession(session)
      if (session?.user) {
        setTimeout(async () => {
          if (!active) return
          await loadProfile(session.user)
          if (active) setLoading(false)
        }, 0)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user)
  }

  const value = { session, user: session?.user ?? null, profile, loading, signOut, refreshProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
