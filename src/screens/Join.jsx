import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import * as api from '../lib/api'
import * as cognito from '../lib/cognito'
import { savePendingJoin, useAuth } from '../auth'
import { AuthShell, LogoMark, Brand, ui } from './AuthShell'
import { patientPrivacyNotice, PRIVACY_NOTICE_VERSION } from '../lib/legal'
import CodeVerify from './CodeVerify'

// /join/:slug — a patient's first entry, from their clinic's invite link.
// Resolves the clinic by slug, collects name + email, sends a sign-in code.
export default function Join() {
  const { slug } = useParams()
  const { session, loading: authLoading } = useAuth()
  const [clinic, setClinic] = useState(undefined) // undefined = loading, null = not found
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [consented, setConsented] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Tied to the notice text itself, so a consent row always names the words
  // the patient actually read. Bumped in lib/legal.js, never here.
  const CONSENT_VERSION = PRIVACY_NOTICE_VERSION

  useEffect(() => {
    api.getClinicBySlug(slug).then(setClinic).catch(() => setClinic(null))
  }, [slug])

  async function sendCode() {
    // localStorage backup drives the frontend re-attach safety net; the primary
    // attach is the post-confirmation Lambda reading this same flow metadata.
    savePendingJoin(slug, fullName.trim(), CONSENT_VERSION)
    return cognito.beginSignUp(email.trim(), {
      flow: 'join',
      clinic_slug: slug,
      full_name: fullName.trim(),
      consent_version: CONSENT_VERSION,
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('Please enter your name.')
    if (!email.trim()) return setError('Please enter your email.')
    if (!consented) return setError('Please agree to the privacy notice to continue.')
    setBusy(true)
    try {
      setPending(await sendCode())
    } catch (err) {
      setError(err?.message || 'Couldn’t send a code just now — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || clinic === undefined) {
    return <AuthShell><div style={ui.muted}>Loading…</div></AuthShell>
  }

  // Already signed in? Don't show the signup form — go straight into the app
  // (which routes patients to their check-in and staff to the dashboard).
  if (session) return <Navigate to="/" replace />


  if (clinic === null) {
    return (
      <AuthShell>
        <LogoMark size={116} />
        <div style={ui.title}>That link wasn’t found.</div>
        <div style={ui.muted}>This clinic invite link isn’t valid. Please check with your clinic for the correct link.</div>
      </AuthShell>
    )
  }

  if (pending) return <CodeVerify pending={pending} onResend={sendCode} onBack={() => setPending(null)} />


  return (
    <AuthShell>
      <LogoMark size={140} />
      <div style={ui.eyebrow}>{clinic.name}</div>
      <div style={ui.title}>Welcome to <Brand /></div>
      <div style={ui.muted}>Your daily check-in, from {clinic.name}. One good day at a time.</div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your name" value={fullName}
          onChange={e => setFullName(e.target.value)} autoComplete="name" />
        <input style={ui.input} placeholder="Your email" type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', cursor: 'pointer', marginTop: 2 }}>
          <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)}
            style={{ marginTop: 3, accentColor: '#F5A81A', width: 16, height: 16, flexShrink: 0 }} />
          <span>I agree that {clinic.name} and GlowPT may store my daily check-ins to support my care, and I’ve read the{' '}
            <span role="button" tabIndex={0}
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true) } }}
              style={{ color: '#F5A81A', textDecoration: 'underline', cursor: 'pointer' }}>
              privacy notice
            </span>.
          </span>
        </label>
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send My Code →'}</button>
      </form>
      <div style={ui.fine}>No password needed. We’ll email you a code.</div>

      {showPrivacy && (
        <div onClick={() => setShowPrivacy(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a2840', border: '1px solid rgba(245,168,26,0.25)', borderRadius: 8, padding: 28, maxWidth: 460, maxHeight: '80vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ ...ui.eyebrow, marginBottom: 14 }}>Privacy Notice</div>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(245,239,228,0.8)' }}>
              {patientPrivacyNotice(clinic.name).map(section => (
                <div key={section.heading} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: 'rgba(245,239,228,0.95)', marginBottom: 4 }}>{section.heading}</div>
                  <p style={{ margin: 0 }}>{section.body}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowPrivacy(false)} style={{ ...ui.btn, marginTop: 18 }}>Close</button>
          </div>
        </div>
      )}
    </AuthShell>
  )
}
