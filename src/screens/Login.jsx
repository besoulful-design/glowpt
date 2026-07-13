import { useState } from 'react'
import { supabase } from '../supabase'
import { AuthShell, LogoMark, ui } from './AuthShell'
import CodeVerify from './CodeVerify'

// /login — returning patients and clinic staff sign in with a 6-digit email code.
export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) { setError(error.message); return false }
    return true
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Please enter your email.')
    setBusy(true)
    const ok = await sendCode()
    setBusy(false)
    if (ok) setSent(true)
  }

  if (sent) return <CodeVerify email={email.trim()} onResend={sendCode} onBack={() => setSent(false)} />

  return (
    <AuthShell>
      <LogoMark size={200} />
      <div style={ui.title}>Sign in to GlowPT</div>
      <div style={ui.muted}>Enter your email and we’ll send you a sign-in code.</div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your email" type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send my code →'}</button>
      </form>
      <div style={ui.fine}>New patient? Use the link your clinic gave you.</div>
    </AuthShell>
  )
}
