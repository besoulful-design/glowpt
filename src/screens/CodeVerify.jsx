import { useState } from 'react'
import { supabase } from '../supabase'
import { AuthShell, LogoMark, ui } from './AuthShell'

const linkBtn = { background: 'none', border: 'none', color: '#c8861d', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }

// Shared step-2 for all sign-in flows: user types the 6-digit code we emailed.
// Everything stays in this one screen/tab, so the session lands where they are.
export default function CodeVerify({ email, onResend, onBack }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)

  async function verify(e) {
    e.preventDefault()
    setError('')
    const token = code.trim()
    if (token.length < 6) return setError('Enter the 6-digit code from your email.')
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    setBusy(false)
    if (error) return setError('That code didn’t work — check it and try again, or resend.')
    // Success: the auth session is now set; AuthProvider picks it up and routes.
  }

  async function resend() {
    setError(''); setResent(false)
    const ok = await onResend?.()
    if (ok) setResent(true)
    else setError('Couldn’t resend just now — try again in a moment.')
  }

  return (
    <AuthShell>
      <LogoMark size={160} />
      <div style={ui.title}>Enter your code</div>
      <div style={ui.muted}>
        We emailed a 6-digit code to <strong style={{ color: '#f5efe4' }}>{email}</strong>. Enter it to sign in.
      </div>
      <form onSubmit={verify} style={ui.form}>
        <input
          style={{ ...ui.input, textAlign: 'center', fontSize: 24, letterSpacing: '0.35em', fontWeight: 600 }}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus
        />
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Verifying…' : 'Verify & sign in →'}</button>
      </form>
      <div style={ui.fine}>
        {resent ? 'New code sent. ' : <>Didn’t get it? <button type="button" onClick={resend} style={linkBtn}>Resend</button>{'  ·  '}</>}
        <button type="button" onClick={onBack} style={linkBtn}>Use a different email</button>
      </div>
    </AuthShell>
  )
}
