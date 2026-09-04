import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import * as api from '../lib/api'
import * as cognito from '../lib/cognito'
import { savePendingStaff, useAuth } from '../auth'
import { AuthShell, LogoMark, Brand, ui } from './AuthShell'
import CodeVerify from './CodeVerify'

// /staff/:token — an invited therapist or manager's first entry, the staff twin
// of /join/:slug. This is the third and last door into an account, and it exists
// because there was no way for a new staff member to get one at all: on Supabase
// they self-created at /login, and the AWS clinic-only model removed that.
//
// ⚠️ THE TOKEN IN THIS URL IS NOT A CREDENTIAL. It names which invite is being
// claimed so the page can say which clinic and which role. Becoming staff still
// requires signing up as the exact address that was invited and proving it with
// an emailed code, and the database checks that in accept_staff_invite. So this
// link is safe to forward, and the email field below is deliberately fixed.
export default function StaffJoin() {
  const { token } = useParams()
  const { session, loading: authLoading } = useAuth()
  const [invite, setInvite] = useState(undefined) // undefined = loading, null = invalid
  const [loadFailed, setLoadFailed] = useState(false)
  const [fullName, setFullName] = useState('')
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getStaffInvite(token)
      .then((inv) => { setInvite(inv); setFullName(inv.full_name || '') })
      .catch((err) => {
        // 404 is the real "this invite is unknown, expired or used". Anything
        // else is the network or the API having a bad moment, and telling
        // someone their good link is invalid would send them off to ask for a
        // replacement they do not need.
        setLoadFailed(err?.status !== 404)
        setInvite(null)
      })
  }, [token])

  async function sendCode() {
    // The primary attach is the post-confirmation Lambda reading this metadata;
    // the localStorage copy is what auth.jsx retries with if that ever misses.
    savePendingStaff(token)
    return cognito.beginSignUp(invite.email, {
      flow: 'staff',
      staff_token: token,
      full_name: fullName.trim(),
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('Please enter your name.')
    setBusy(true)
    try {
      setPending(await sendCode())
    } catch (err) {
      setError(err?.message || 'Couldn’t send a code just now. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return null
  if (session) return <Navigate to="/dashboard" replace />
  if (invite === undefined) return <AuthShell><div style={ui.muted}>Loading…</div></AuthShell>

  // Unknown, expired, already used: all one message. Nothing here tells a
  // stranger whether a given token ever existed.
  if (invite === null) {
    return (
      <AuthShell>
        <LogoMark size={116} />
        <div style={ui.title}>
          {loadFailed ? 'We couldn’t load this invite.' : 'This invite isn’t valid.'}
        </div>
        <div style={ui.muted}>
          {loadFailed ? (
            <div>Something went wrong at our end. Please try the link again in a moment.</div>
          ) : (
            <>
              <div>The link may have expired or already been used.</div>
              <div>Ask your clinic manager to send you a new one.</div>
            </>
          )}
        </div>
      </AuthShell>
    )
  }

  if (pending) return <CodeVerify pending={pending} onResend={sendCode} onBack={() => setPending(null)} />

  const roleWord = invite.role === 'manager' ? 'a manager' : 'a therapist'

  return (
    <AuthShell>
      <LogoMark size={140} />
      <div style={ui.eyebrow}>{invite.clinic_name}</div>
      <div style={ui.title}>Join <Brand /></div>
      <div style={ui.muted}>
        <div>{invite.clinic_name} invited you as {roleWord}.</div>
        <div>Confirm your name to set up your account.</div>
      </div>
      <form onSubmit={handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your name" value={fullName}
          onChange={e => setFullName(e.target.value)} autoComplete="name" />
        {/* Fixed, not editable: the invite is FOR this address, and the database
            refuses the claim if the signed-up email differs. An editable field
            would invite people to type their own and hit a confusing refusal. */}
        <div style={s.fixedEmail}>
          <div style={s.fixedEmailLabel}>Signing up as</div>
          <div style={s.fixedEmailValue}>{invite.email}</div>
        </div>
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>{busy ? 'Sending…' : 'Send My Code →'}</button>
      </form>
      <div style={ui.fine}>No password needed. We’ll email you a code.</div>
    </AuthShell>
  )
}

const s = {
  fixedEmail: {
    background: 'rgba(245,239,228,0.04)',
    border: '1px solid rgba(245,239,228,0.1)',
    borderRadius: 4,
    padding: '12px 16px',
    textAlign: 'left',
  },
  fixedEmailLabel: { fontSize: 12, lineHeight: 1.5, color: 'rgba(245,239,228,0.45)' },
  fixedEmailValue: { fontSize: 15, lineHeight: 1.5, color: '#f5efe4', wordBreak: 'break-all' },
}
