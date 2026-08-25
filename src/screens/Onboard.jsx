import { useState } from 'react'
import * as api from '../lib/api'
import * as cognito from '../lib/cognito'
import { savePendingOnboard } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'
import { BAA_IS_EXECUTED, BAA_SUMMARY, BAA_SUMMARY_INTRO } from '../lib/legal'
import CodeVerify from './CodeVerify'

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}


// /onboard — a clinic creates its account, reviews the BAA, and gets its patient link.
export default function Onboard() {
  const [clinicName, setClinicName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [baaReviewed, setBaaReviewed] = useState(false)
  const [showBaa, setShowBaa] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)

  const effectiveSlug = slugEdited ? slug : slugify(clinicName)

  // Create the clinic under the entered email (a fresh manager account), verified
  // by an email code — so onboarding never hijacks whoever is currently signed in.
  async function sendCode() {
    savePendingOnboard(clinicName.trim(), effectiveSlug, fullName.trim())
    return cognito.beginSignUp(email.trim(), {
      flow: 'onboard',
      onboard_clinic_name: clinicName.trim(),
      onboard_clinic_slug: effectiveSlug,
      full_name: fullName.trim(),
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!clinicName.trim()) return setError('Please enter your clinic name.')
    if (!effectiveSlug) return setError('Please enter a valid clinic web name.')
    if (!fullName.trim()) return setError('Please enter your name.')
    if (!email.trim()) return setError('Please enter your work email.')
    if (!baaReviewed) return setError('Please confirm you’ve reviewed the BAA.')
    setBusy(true)

    // Make sure the slug isn't already taken (getClinicBySlug 404 = available).
    try {
      await api.getClinicBySlug(effectiveSlug)
      setBusy(false)
      return setError('That clinic web name is taken — try another.')
    } catch (err) {
      if (err.status !== 404) {
        setBusy(false)
        return setError('Couldn’t check that name just now — try again.')
      }
    }

    try {
      setPending(await sendCode())
    } catch (err) {
      setError(err?.message || 'Couldn’t send a code just now — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (pending) return <CodeVerify pending={pending} onResend={sendCode} onBack={() => setPending(null)} />


  return (
    <AuthShell>
      <LogoMark size={128} />
      <div style={ui.eyebrow}>For clinics</div>
      <div style={ui.title}>Bring GlowPT to your clinic</div>
      <div style={ui.muted}>Set up your clinic in a minute. You’ll get a private link to share with your patients.</div>

      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Clinic name (e.g. Riverside PT)" value={clinicName}
          onChange={e => { setClinicName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)) }} />
        <div style={{ textAlign: 'left', fontSize: 12, color: 'rgba(245,239,228,0.4)', marginTop: -4 }}>
          Patient link: {window.location.host}/join/<strong style={{ color: '#F5A81A' }}>{effectiveSlug || 'your-clinic'}</strong>
        </div>
        <input style={ui.input} placeholder="Clinic web name" value={effectiveSlug}
          onChange={e => { setSlugEdited(true); setSlug(slugify(e.target.value)) }} />
        <input style={ui.input} placeholder="Your name" value={fullName}
          onChange={e => setFullName(e.target.value)} autoComplete="name" />
        <input style={ui.input} placeholder="Your work email" type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', cursor: 'pointer', marginTop: 2 }}>
          <input type="checkbox" checked={baaReviewed} onChange={e => setBaaReviewed(e.target.checked)}
            style={{ marginTop: 3, accentColor: '#F5A81A', width: 16, height: 16, flexShrink: 0 }} />
          <span>{BAA_IS_EXECUTED ? 'I agree to the' : 'I’ve reviewed the'}{' '}
            <button type="button" onClick={() => setShowBaa(true)}
              style={{ background: 'none', border: 'none', color: '#F5A81A', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>
              Business Associate Agreement
            </button>.
          </span>
        </label>

        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Setting up…' : 'Create my clinic →'}</button>
      </form>
      {!BAA_IS_EXECUTED && (
        <div style={ui.fine}>This is a summary. You’ll review and sign the full agreement before any real patient information enters GlowPT.</div>
      )}

      {showBaa && (
        <div onClick={() => setShowBaa(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a2840', border: '1px solid rgba(245,168,26,0.25)', borderRadius: 8, padding: 28, maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ ...ui.eyebrow, marginBottom: 14 }}>Business Associate Agreement</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'rgba(245,239,228,0.78)' }}>
              {!BAA_IS_EXECUTED && (
                <p style={{ marginTop: 0, marginBottom: 18, fontStyle: 'italic', color: 'rgba(245,239,228,0.55)' }}>{BAA_SUMMARY_INTRO}</p>
              )}
              {BAA_SUMMARY.map(section => (
                <div key={section.heading} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: 'rgba(245,239,228,0.95)', marginBottom: 4 }}>{section.heading}</div>
                  <p style={{ margin: 0 }}>{section.body}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowBaa(false)} style={{ ...ui.btn, marginTop: 20 }}>Close</button>
          </div>
        </div>
      )}
    </AuthShell>
  )
}
