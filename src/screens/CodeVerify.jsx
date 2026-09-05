import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as cognito from '../lib/cognito'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'

const linkBtn = { background: 'none', border: 'none', color: '#F5A81A', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }

// Shared step-2 for all sign-in flows: user types the code we emailed.
// `pending` is the flow object from cognito.beginSignIn / beginSignUp (it knows
// whether this is a returning sign-in or a new-account confirm). Everything stays
// in this one screen/tab, so the session lands where they are.
export default function CodeVerify({ pending, onResend, onBack }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)
  const [flow, setFlow] = useState(pending)
  const navigate = useNavigate()
  const { onSignedIn } = useAuth()
  const submitting = useRef(false) // guards a double submit (iOS one-time-code autofill + tap)

  async function verify(e) {
    e.preventDefault()
    setError('')
    if (submitting.current) return
    const token = code.trim()
    if (token.length < 6) return setError('Enter the full code from your email.')
    submitting.current = true
    setBusy(true)
    try {
      await cognito.confirm(flow, token)
      // Signed in: load the profile, then hand off to the router ("/" routes by
      // role). Keep busy=true so the form doesn't flash back before we navigate.
      await onSignedIn()
      navigate('/', { replace: true })
      return
    } catch (err) {
      submitting.current = false
      setBusy(false)
      // ⚠️ ALWAYS LOG THE REAL ERROR. This used to collapse CodeMismatch,
      // NotAuthorized, ExpiredCode and "did not complete" into ONE message and
      // log nothing, so a wrong code and a dead session were indistinguishable
      // from the outside. That cost a diagnosis on 2026-09-05: three rejected
      // codes with no way to tell which failure it was.
      console.error('sign-in failed:', err?.name, err?.message)
      const name = err?.name || ''
      const text = err?.message || ''
      // A stale or expired challenge needs a NEW code; retyping cannot fix it.
      // Cognito says this several ways, including NotAuthorized "Invalid session".
      const stale = /ExpiredCode|Invalid session|session is expired|NotAuthorized/i.test(`${name} ${text}`)
      const mismatch = /CodeMismatch/i.test(name)
      setError(
        mismatch
          ? 'That code didn’t match. Check it and try again.'
          : stale
            ? 'That code has expired. Tap Resend below for a fresh one, and use the newest email.'
            : 'Something went wrong signing you in. Tap Resend below for a fresh code.',
      )
    }
  }

  async function resend() {
    setError(''); setResent(false); setCode('')
    try {
      const next = await onResend?.()
      if (next) setFlow(next) // the session rotates on a fresh sign-in code
      setResent(true)
    } catch {
      setError('Couldn’t resend just now. Try again in a moment.')
    }
  }

  return (
    <AuthShell>
      <LogoMark size={120} />
      <div style={ui.title}>Enter Your Code</div>
      <div style={ui.muted}>
        We emailed a code to <strong style={{ color: '#f5efe4' }}>{pending.email}</strong>. Enter it to sign in.
      </div>
      <form onSubmit={verify} style={ui.form}>
        <input
          style={{ ...ui.input, textAlign: 'center', fontSize: 24, letterSpacing: '0.3em', fontWeight: 600 }}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric" autoComplete="one-time-code" placeholder="Enter code" maxLength={10} autoFocus
        />
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Verifying…' : 'Verify & sign in →'}</button>
      </form>
      {/* ⚠️ Resend STAYS on screen after it is used. It used to be replaced by
          "New code sent.", so the one control that fixes an expired code could
          be used exactly once and then vanished, on the very screen where
          someone is most likely to need it twice. */}
      <div style={ui.fine}>
        {resent ? 'New code sent. Use the newest email. ' : 'Didn’t get it? '}
        <button type="button" onClick={resend} style={linkBtn}>Resend</button>
        {'  ·  '}
        <button type="button" onClick={onBack} style={linkBtn}>Use a Different Email</button>
      </div>
    </AuthShell>
  )
}
