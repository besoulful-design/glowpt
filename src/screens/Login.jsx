import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import * as cognito from '../lib/cognito'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, Brand, ui } from './AuthShell'
import CodeVerify from './CodeVerify'

// /login — returning patients and clinic staff sign in with an email code.
export default function Login() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { session, loading } = useAuth()

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
      setError(err?.message || 'Couldn’t send a code just now. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (pending) return <CodeVerify pending={pending} onResend={sendCode} onBack={() => setPending(null)} />

  // Someone who is already signed in has nothing to do here. Send them to "/",
  // which routes by role (patient app, dashboard, or NoClinic). This is what
  // lets the weekly email point at /login for everyone: a patient whose tokens
  // are still good lands in their check-in, and only a lapsed session sees the
  // form. Before this, /login rendered the form to a signed-in person, which
  // is why the email had to point at "/" and so showed the SALES page to a
  // signed-out patient (David saw James land there, 2026-09-08).
  if (loading) return <AuthShell><LogoMark /><div style={ui.muted}>Loading…</div></AuthShell>
  if (session) return <Navigate to="/" replace />

  return (
    <AuthShell>
      <LogoMark />
      <div style={ui.title}>Sign In to <Brand /></div>
      <div style={ui.muted}>Enter your email and we’ll send you a sign-in code.</div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your email" type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send My Code →'}</button>
      </form>
      <div style={ui.fine}>New patient? Use the link your clinic gave you.</div>
    </AuthShell>
  )
}
