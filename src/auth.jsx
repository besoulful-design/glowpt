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
  async function loadProfile(userId) {
    // Apply a pending clinic ONBOARD, if the user arrived from the /onboard flow.
    const onboardRaw = localStorage.getItem(PENDING_ONBOARD_KEY)
    if (onboardRaw) {
      try {
        const { clinicName, slug, fullName } = JSON.parse(onboardRaw)
        const { error } = await supabase.rpc('provision_clinic', { p_name: clinicName, p_slug: slug })
        if (error) console.log('provision_clinic error:', error.message)
        if (fullName) await supabase.from('profiles').update({ full_name: fullName }).eq('id', userId)
      } catch (err) {
        console.log('Pending onboard failed:', err.message)
      }
      localStorage.removeItem(PENDING_ONBOARD_KEY)
    }

    // Apply a pending clinic join, if the user arrived from a /join/<slug> link.
    const pendingRaw = localStorage.getItem(PENDING_JOIN_KEY)
    if (pendingRaw) {
      try {
        const { slug, fullName, consentVersion } = JSON.parse(pendingRaw)
        const { data: clinic } = await supabase
          .from('clinics').select('id').eq('slug', slug).single()
        if (clinic) {
          await supabase.from('profiles').upsert({
            id: userId,
            clinic_id: clinic.id,
            role: 'patient',
            full_name: fullName || null,
          }, { onConflict: 'id' })
          // Record the patient's HIPAA acknowledgment (who / when / which version).
          if (consentVersion) {
            await supabase.from('consents').insert({
              user_id: userId,
              clinic_id: clinic.id,
              type: 'hipaa_patient_ack',
              version: consentVersion,
            })
          }
        }
      } catch (err) {
        console.log('Pending join failed:', err.message)
      }
      localStorage.removeItem(PENDING_JOIN_KEY)
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, clinic_id, role, full_name, therapist_id')
      .eq('id', userId)
      .single()
    if (error) console.log('Profile load error:', error.message)
    setProfile(data || null)
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
          await loadProfile(session.user.id)
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
    if (session?.user) await loadProfile(session.user.id)
  }

  const value = { session, user: session?.user ?? null, profile, loading, signOut, refreshProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
