import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'

// /join/:slug -- what is left of the old walk-in sign-up page.
//
// ⛔ THERE IS NO FORM HERE ANY MORE, AND THAT IS THE POINT (David, 2026-09-18:
// "remove the dead join page code"). Walk-in sign-up was removed on 2026-09-05
// and every clinic has been invite only since, so the name fields, the consent
// box, the privacy modal and the code screen that used to live in this file
// could never be reached. They went, along with the two pieces that existed
// only to serve them: savePendingJoin's safety net in auth.jsx, and the
// joinClinic call in the API client.
//
// ⚠️ THIS COMMENT NEVER WRITES THE API ALIAS FOLLOWED BY A DOT, deliberately.
// scripts/check-namespace-imports.mjs reads comments as well as code, runs on
// every Amplify build, and failed twice on this file's own explanation of what
// was removed -- once on the function's name, once on the client's filename.
//
// ⚠️ THE PAGE ITSELF STAYS, as one sentence. Someone may still hold an old
// /join link or a QR printed before 09-05, and "you'll need an invite" is a
// kinder dead end than being dropped on the sales page by the catch-all route.
//
// ⚠️ THE DATABASE SIDE IS DELIBERATELY UNTOUCHED: join_clinic, the open_signup
// column and its gate, and the API route are kept so walk-in sign-up COULD
// return, which was David's call on 2026-09-05. Removing this page does not
// change that decision; bringing the feature back would mean writing a form
// again, not deleting a gate.
export default function Join() {
  const { slug } = useParams()
  const { session, loading: authLoading } = useAuth()
  const [clinic, setClinic] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => {
    api.getClinicBySlug(slug).then(setClinic).catch(() => setClinic(null))
  }, [slug])

  if (authLoading || clinic === undefined) {
    return <AuthShell><div style={ui.muted}>Loading…</div></AuthShell>
  }

  // Signed in already: an old link is no reason to stop someone reaching their
  // check-in, so go straight into the app.
  if (session) return <Navigate to="/" replace />

  if (clinic === null) {
    return (
      <AuthShell>
        <LogoMark />
        <div style={ui.title}>That link wasn’t found.</div>
        <div style={ui.muted}>Ask your clinic to send you an invite, and you’ll get a link by email.</div>
      </AuthShell>
    )
  }

  // One answer whether the clinic is open or not: the way in is an invite
  // either way, so a second message would only be a second way to say it.
  return (
    <AuthShell>
      <LogoMark />
      <div style={ui.eyebrow}>{clinic.name}</div>
      <div style={ui.title}>You’ll need an invite.</div>
      <div style={ui.muted}>
        <div>{clinic.name} adds patients to GlowPT one at a time.</div>
        <div>Ask them to send you an invite and you’ll get a link by email.</div>
      </div>
    </AuthShell>
  )
}
