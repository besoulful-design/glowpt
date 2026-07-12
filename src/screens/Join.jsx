import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { savePendingJoin } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'

// /join/:slug — a patient's first entry, from their clinic's invite link.
// Resolves the clinic by slug, collects name + email, sends a magic link.
export default function Join() {
  const { slug } = useParams()
  const [clinic, setClinic] = useState(undefined) // undefined = loading, null = not found
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [consented, setConsented] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const CONSENT_VERSION = 'v1'

  useEffect(() => {
    supabase.from('clinics').select('id, name, slug').eq('slug', slug).single()
      .then(({ data }) => setClinic(data ?? null))
  }, [slug])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('Please enter your name.')
    if (!email.trim()) return setError('Please enter your email.')
    if (!consented) return setError('Please agree to the privacy notice to continue.')
    setBusy(true)
    savePendingJoin(slug, fullName.trim(), CONSENT_VERSION)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (clinic === undefined) {
    return <AuthShell><div style={ui.muted}>Loading…</div></AuthShell>
  }

  if (clinic === null) {
    return (
      <AuthShell>
        <LogoMark size={160} />
        <div style={ui.title}>Link not found</div>
        <div style={ui.muted}>This clinic invite link isn’t valid. Please check with your clinic for the correct link.</div>
      </AuthShell>
    )
  }

  if (sent) {
    return (
      <AuthShell>
        <LogoMark size={160} />
        <div style={ui.title}>Check your email</div>
        <div style={ui.muted}>
          We sent a sign-in link to <strong style={{ color: '#f5efe4' }}>{email}</strong>.
          Tap it to start your first check-in with {clinic.name}.
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <LogoMark size={200} />
      <div style={ui.eyebrow}>{clinic.name}</div>
      <div style={ui.title}>Welcome to GlowPT</div>
      <div style={ui.muted}>Your daily check-in, from {clinic.name}. One good day at a time.</div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your name" value={fullName}
          onChange={e => setFullName(e.target.value)} autoComplete="name" />
        <input style={ui.input} placeholder="Your email" type="email" value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="email" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', cursor: 'pointer', marginTop: 2 }}>
          <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)}
            style={{ marginTop: 3, accentColor: '#c8861d', width: 16, height: 16, flexShrink: 0 }} />
          <span>I agree that {clinic.name} and GlowPT may store my daily check-ins to support my care, and I’ve read the privacy notice.</span>
        </label>
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send my sign-in link →'}</button>
      </form>
      <div style={ui.fine}>No password needed. We’ll email you a secure link.</div>
    </AuthShell>
  )
}
