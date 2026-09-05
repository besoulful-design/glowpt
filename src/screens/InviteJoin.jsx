import { useEffect, useState } from 'react'
import { useParams, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import * as cognito from '../lib/cognito'
import { savePendingStaff, savePendingPatientInvite, useAuth } from '../auth'
import { AuthShell, LogoMark, Brand, ui } from './AuthShell'
import { useModal } from '../lib/useModal'
import { patientPrivacyNotice, PRIVACY_NOTICE_VERSION } from '../lib/legal'
import CodeVerify from './CodeVerify'

// /invite/:token — the invited person's first entry, for staff AND patients.
// (Also mounted at /staff/:token, which is where the first staff invite links
// pointed; those live 14 days, so the alias stays until they have expired.)
//
// This is the third door into an account, and as of 2026-09-05 it is the ONLY
// one for a patient anywhere: the walk-in join link and QR were removed.
//
// ⚠️ THE TOKEN IN THIS URL IS NOT A CREDENTIAL. It names which invite is being
// claimed so the page can say which clinic and which role. Joining still
// requires signing up as the exact address that was invited and proving it with
// an emailed code, and the database checks that. So this link is safe to
// forward, and the email below is deliberately fixed rather than an input.
export default function InviteJoin() {
  const { token } = useParams()
  const { session, user, profile, loading: authLoading, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(undefined) // undefined = loading, null = invalid
  const [loadFailed, setLoadFailed] = useState(false)
  const [fullName, setFullName] = useState('')
  const [consented, setConsented] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const panelRef = useModal(showPrivacy, () => setShowPrivacy(false))
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Tied to the notice text itself, so a consent row always names the words the
  // patient actually read. Bumped in lib/legal.js, never here.
  const CONSENT_VERSION = PRIVACY_NOTICE_VERSION

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

  const isPatient = invite?.role === 'patient'

  async function sendCode() {
    // The primary attach is the post-confirmation Lambda reading this metadata;
    // the localStorage copy is what auth.jsx retries with if that ever misses.
    if (isPatient) savePendingPatientInvite(token, CONSENT_VERSION)
    else savePendingStaff(token)
    return cognito.beginSignUp(invite.email, {
      flow: isPatient ? 'patient_invite' : 'staff',
      staff_token: token,
      full_name: fullName.trim(),
      ...(isPatient ? { consent_version: CONSENT_VERSION } : {}),
    })
  }

  // Already signed in. No sign-up to do, so claim the invite directly with the
  // session we already have. Same RPCs the post-confirmation Lambda calls.
  async function claimAsSignedIn(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('Please enter your name.')
    if (isPatient && !consented) return setError('Please agree to the privacy notice to continue.')
    setBusy(true)
    try {
      if (isPatient) await api.acceptPatientInvite(token, CONSENT_VERSION)
      else await api.acceptStaffInvite(token)
      if (fullName.trim()) { try { await api.updateMe(fullName.trim()) } catch { /* name is not worth failing the join over */ } }
      await refreshProfile()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err?.message || 'Couldn’t finish joining just now. Try again.')
      setBusy(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('Please enter your name.')
    if (isPatient && !consented) return setError('Please agree to the privacy notice to continue.')
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

  // ⚠️ THIS USED TO BE `if (session) return <Navigate to="/dashboard" />`, which
  // made an invite link USELESS to anyone already signed in. An invited patient
  // who signed in at /login first (rather than opening their link) has no
  // pending attach in localStorage, and the blind safety net deliberately skips
  // patient invites because it cannot record consent. So they landed on
  // NoClinic, and clicking their invite link bounced them straight back to it.
  // A closed loop with a live invite sitting unused. (Hit by David 2026-09-05.)
  //
  // Already attached: nothing to claim, send them on.
  if (session && profile?.clinic_id) return <Navigate to="/dashboard" replace />
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
              <div>Ask your clinic to send you a new one.</div>
            </>
          )}
        </div>
      </AuthShell>
    )
  }

  if (pending) return <CodeVerify pending={pending} onResend={sendCode} onBack={() => setPending(null)} />

  // Signed in as somebody else. Say so plainly rather than letting the database
  // refuse them with a message they cannot act on.
  const signedInAsSomeoneElse =
    session && user?.email && user.email.toLowerCase() !== invite.email.toLowerCase()
  if (signedInAsSomeoneElse) {
    return (
      <AuthShell>
        <LogoMark size={116} />
        <div style={ui.eyebrow}>{invite.clinic_name}</div>
        <div style={ui.title}>This invite is for someone else.</div>
        <div style={ui.muted}>
          <div>It was sent to {invite.email}, and you’re signed in as {user.email}.</div>
          <div>Sign out, then open this link again.</div>
        </div>
        <button style={ui.btn} onClick={signOut}>Sign Out</button>
      </AuthShell>
    )
  }

  const claiming = Boolean(session)

  const roleWord = invite.role === 'manager' ? 'a manager'
    : invite.role === 'patient' ? 'a patient' : 'a therapist'

  return (
    <AuthShell>
      <LogoMark size={140} />
      <div style={ui.eyebrow}>{invite.clinic_name}</div>
      <div style={ui.title}>Join <Brand /></div>
      <div style={ui.muted}>
        <div>{invite.clinic_name} invited you as {roleWord}.</div>
        <div>{isPatient ? 'Confirm your name to start checking in.' : 'Confirm your name to set up your account.'}</div>
      </div>
      <form onSubmit={claiming ? claimAsSignedIn : handleSubmit} style={ui.form}>
        <input style={ui.input} placeholder="Your name" value={fullName}
          onChange={e => setFullName(e.target.value)} autoComplete="name" />
        {/* Fixed, not editable: the invite is FOR this address, and the database
            refuses the claim if the signed-up email differs. An editable field
            would invite people to type their own and hit a confusing refusal. */}
        <div style={s.fixedEmail}>
          <div style={s.fixedEmailLabel}>{claiming ? 'Signed in as' : 'Signing up as'}</div>
          <div style={s.fixedEmailValue}>{invite.email}</div>
        </div>
        {isPatient && (
          <label style={s.consent}>
            <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)}
              style={{ marginTop: 3, accentColor: '#F5A81A', width: 16, height: 16, flexShrink: 0 }} />
            <span>I agree that {invite.clinic_name} and GlowPT may store my daily check-ins to support my care, and I’ve read the{' '}
              {/* A span, not a button: a button cannot wrap mid-phrase, which
                  stranded the trailing period on its own line at phone width.
                  preventDefault as well as stopPropagation, or opening the
                  modal would silently tick the checkbox too. */}
              <span role="button" tabIndex={0}
                onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true) } }}
                style={{ color: '#F5A81A', textDecoration: 'underline', cursor: 'pointer' }}>
                privacy notice
              </span>.
            </span>
          </label>
        )}
        {error && <div style={ui.error}>{error}</div>}
        <button style={ui.btn} disabled={busy}>
          {claiming
            ? (busy ? 'Joining…' : `Join ${invite.clinic_name} →`)
            : (busy ? 'Sending…' : 'Send My Code →')}
        </button>
      </form>
      {/* Someone already signed in needs no code, so promising one would be the
          same contradiction the invite email had. */}
      <div style={ui.fine}>
        {claiming ? 'You’re already signed in, so there’s nothing else to confirm.' : 'No password needed. We’ll email you a code.'}
      </div>

      {showPrivacy && (
        <div style={s.overlay} onClick={() => setShowPrivacy(false)}>
          <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="privacy-title"
            style={s.panel} onClick={e => e.stopPropagation()}>
            <button type="button" style={ui.modalCloseX} onClick={() => setShowPrivacy(false)} aria-label="Close">✕</button>
            <div id="privacy-title" style={{ ...ui.eyebrow, marginBottom: 14 }}>Privacy Notice</div>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(245,239,228,0.8)' }}>
              {patientPrivacyNotice(invite.clinic_name).map((sec, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: '#f5efe4', marginBottom: 4 }}>{sec.heading}</div>
                  <div>{sec.body}</div>
                </div>
              ))}
            </div>
            <button type="button" style={ui.modalCloseBtn} onClick={() => setShowPrivacy(false)}>Close</button>
          </div>
        </div>
      )}
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
  consent: {
    display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left',
    fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', cursor: 'pointer', marginTop: 2,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(5,10,18,0.75)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50,
  },
  panel: {
    position: 'relative', background: '#1a2840', border: '1px solid rgba(245,168,26,0.25)',
    borderRadius: 8, padding: '26px 24px', maxWidth: 460, width: '100%', maxHeight: '80vh',
    overflowY: 'auto', textAlign: 'left', outline: 'none',
  },
}
