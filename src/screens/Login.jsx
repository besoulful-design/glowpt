import { useState } from 'react'
import * as cognito from '../lib/cognito'
import { AuthShell, LogoMark, ui } from './AuthShell'
import CodeVerify from './CodeVerify'

// /login — returning patients and clinic staff sign in with an email code.
export default function Login() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    // Returning user: existence errors are prevented at the pool, so an unknown
    // email still gets the code screen (no enumeration of who is a GlowPT patient).
    return cognito.beginSignIn(email.trim())
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Please enter your email.')
    setBusy(true)
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
