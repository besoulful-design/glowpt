import { useState } from 'react'
import { supabase } from '../supabase'
import { savePendingOnboard } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'
import CodeVerify from './CodeVerify'

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Placeholder BAA text — David swaps in the real agreement before go-live.
const BAA_TEXT = `BUSINESS ASSOCIATE AGREEMENT (SUMMARY — PLACEHOLDER)

This is placeholder text. Replace with the real Business Associate Agreement
between FranklinAI (David Peterson) and the clinic before onboarding real patients.

In plain terms, the full BAA will cover: how patient information is protected,
how it may be used and shared, breach notification, and each party's
responsibilities under HIPAA. You will formally sign this when your clinic goes
live with real patients.`

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
  const [sent, setSent] = useState(false)

  const effectiveSlug = slugEdited ? slug : slugify(clinicName)

  // Create the clinic under the entered email (a fresh manager account), verified
  // by a 6-digit code — so onboarding never hijacks whoever is currently signed in.
  async function sendCode() {
    savePendingOnboard(clinicName.trim(), effectiveSlug, fullName.trim())
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + '/dashboard',
        data: { full_name: fullName.trim(), onboard_clinic_name: clinicName.trim(), onboard_clinic_slug: effectiveSlug },
      },
    })
    if (otpErr) { setError(otpErr.message); return false }
    return true
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

    // Make sure the slug isn't already taken.
    const { data: existing } = await supabase.from('clinics').select('id').eq('slug', effectiveSlug).maybeSingle()
    if (existing) { setBusy(false); return setError('That clinic web name is taken — try another.') }

    const ok = await sendCode()
    setBusy(false)
    if (ok) setSent(true)
  }

  if (sent) return <CodeVerify email={email.trim()} onResend={sendCode} onBack={() => setSent(false)} />


  return (
    <AuthShell>
      <LogoMark size={170} />
      <div style={ui.eyebrow}>For clinics</div>
      <div style={ui.title}>Bring GlowPT to your clinic</div>
      <div style={ui.muted}>Set up your clinic in a minute. You’ll get a private link to share with your patients.</div>

      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Clinic name (e.g. Riverside PT)" value={clinicName}
          onChange={e => { setClinicName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)) }} />
        <div style={{ textAlign: 'left', fontSize: 12, color: 'rgba(245,239,228,0.4)', marginTop: -4 }}>
          Patient link: glowpt-app.netlify.app/join/<strong style={{ color: '#c8861d' }}>{effectiveSlug || 'your-clinic'}</strong>
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
            style={{ marginTop: 3, accentColor: '#c8861d', width: 16, height: 16, flexShrink: 0 }} />
          <span>I’ve reviewed the{' '}
            <button type="button" onClick={() => setShowBaa(true)}
              style={{ background: 'none', border: 'none', color: '#c8861d', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>
              Business Associate Agreement
            </button>.
          </span>
        </label>

        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Setting up…' : 'Create my clinic →'}</button>
      </form>
      <div style={ui.fine}>You’ll formally sign the BAA when you go live with real patients.</div>

      {showBaa && (
        <div onClick={() => setShowBaa(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a2840', border: '1px solid rgba(200,134,29,0.25)', borderRadius: 8, padding: 28, maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ ...ui.eyebrow, marginBottom: 14 }}>Business Associate Agreement</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'DM Sans', sans-serif", fontSize: 13, lineHeight: 1.6, color: 'rgba(245,239,228,0.75)', margin: 0 }}>{BAA_TEXT}</pre>
            <button onClick={() => setShowBaa(false)} style={{ ...ui.btn, marginTop: 20 }}>Close</button>
          </div>
        </div>
      )}
    </AuthShell>
  )
}
