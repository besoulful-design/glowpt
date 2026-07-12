import { useState } from 'react'
import { supabase } from '../supabase'
import { AuthShell, LogoMark, ui } from './AuthShell'

// /login — returning patients and clinic staff sign in with a magic link.
export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Please enter your email.')
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell>
        <LogoMark size={160} />
        <div style={ui.title}>Check your email</div>
        <div style={ui.muted}>
          We sent a sign-in link to <strong style={{ color: '#f5efe4' }}>{email}</strong>. Tap it to sign in.
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <LogoMark size={200} />
      <div style={ui.title}>Sign in to GlowPT</div>
      <div style={ui.muted}>Enter your email and we’ll send you a secure sign-in link.</div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your email" type="email" value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="email" />
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send my sign-in link →'}</button>
      </form>
      <div style={ui.fine}>New patient? Use the link your clinic gave you.</div>
    </AuthShell>
  )
}
