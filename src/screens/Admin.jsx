import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, BrandLockup, BRAND, ui } from './AuthShell'
import { BAA_VERSION } from '../lib/legal'

// /admin — David's cross-clinic operator view. Every clinic on the platform,
// with the switch that decides whether it may enrol patients at all.
//
// This screen shows NO PHI. admin_list_clinics() returns counts and timestamps
// plus the clinic manager's contact — never a patient name, never a check-in.
// That constraint lives in the SQL, not here, so it holds no matter what this
// file renders.
//
// Being signed in is not being an admin: the server decides. A non-admin who
// types /admin gets a 403 from the API and is bounced home.

const s = {
  // textAlign is declared HERE, not inherited from #root — see src/index.css.
  page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', borderBottom: '1px solid rgba(245,239,228,0.08)', flexWrap: 'wrap', gap: 12 },
  navLink: { fontSize: 13, fontWeight: 600, color: BRAND, textDecoration: 'none', border: '1px solid rgba(245,168,26,0.4)', borderRadius: 4, padding: '7px 14px' },
  signOut: { fontSize: 13, color: 'rgba(245,239,228,0.5)', background: 'transparent', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '7px 14px', cursor: 'pointer' },
  wrap: { maxWidth: 1040, margin: '0 auto', padding: '24px clamp(14px, 4vw, 28px) 60px' },
  h1: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 30, marginBottom: 4 },
  sub: { fontSize: 14, color: 'rgba(245,239,228,0.5)', marginBottom: 26 },
  card: { background: '#1a2840', border: '1px solid rgba(245,168,26,0.18)', borderRadius: 6, padding: '18px 20px', marginBottom: 14 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  name: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, marginBottom: 2 },
  // Named for what it USED to carry; it now holds the created date alone.
  slug: { fontSize: 12.5, color: 'rgba(245,239,228,0.45)', marginBottom: 10 },
  pill: { fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap' },
  pillOpen: { background: 'rgba(182,194,74,0.18)', color: '#c9d66a', border: '1px solid rgba(182,194,74,0.35)' },
  pillClosed: { background: 'rgba(245,168,26,0.14)', color: '#F5A81A', border: '1px solid rgba(245,168,26,0.4)' },
  meta: { display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13, color: 'rgba(245,239,228,0.7)', marginTop: 12 },
  metaLabel: { fontSize: 11.5, color: 'rgba(245,239,228,0.45)', marginBottom: 2 },
  contact: { fontSize: 13, color: 'rgba(245,239,228,0.6)', marginTop: 10 },
  contactLink: { color: BRAND },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(245,239,228,0.1)' },
  btn: { fontSize: 13.5, fontWeight: 600, borderRadius: 4, padding: '9px 16px', cursor: 'pointer', border: 'none' },
  btnOpen: { background: BRAND, color: '#0d1825' },
  btnClose: { background: 'transparent', color: 'rgba(245,239,228,0.75)', border: '1px solid rgba(245,239,228,0.22)' },
  btnBaa: { background: 'transparent', color: BRAND, border: '1px solid rgba(245,168,26,0.4)' },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  btnDanger: { background: 'transparent', color: '#e88b7d', border: '1px solid rgba(232,139,125,0.45)' },
  // textAlign is explicit: this page centers its copy, and a warning you have
  // to read plus a field you have to type in both want a left edge.
  deleteBox: { border: '1px solid rgba(232,139,125,0.35)', borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' },
  fieldLabel: { fontSize: 12, lineHeight: 1.5, color: 'rgba(245,239,228,0.45)' },
  input: { background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '9px 12px', color: '#f5efe4', fontSize: 14, fontFamily: 'inherit', maxWidth: 320 },
  notice: { fontSize: 13.5, lineHeight: 1.6, color: '#c9d66a', marginBottom: 14 },
  archivedHead: { fontFamily: "'Fraunces', serif", fontStyle: 'normal', fontSize: 26, fontWeight: 400, marginTop: 34, marginBottom: 4 },
  baaDone: { fontSize: 13, color: 'rgba(245,239,228,0.7)', alignSelf: 'center' },
  clearLink: { color: BRAND, textDecoration: 'underline', cursor: 'pointer' },
  hint: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', alignSelf: 'center' },
  confirmQ: { fontSize: 13, color: 'rgba(245,239,228,0.8)', alignSelf: 'center' },
  error: { ...ui.error, marginBottom: 16 },
  empty: { fontSize: 14, color: 'rgba(245,239,228,0.5)' },
}

function when(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Admin() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [allowed, setAllowed] = useState(undefined) // undefined = checking
  const [clinics, setClinics] = useState([])
  // The back link names the clinic itself rather than saying "Dashboard": one
  // button names a set of clinics, the other names a specific clinic, so which
  // is which needs no knowledge of roles. Nothing in the UI says "admin".
  const [myClinic, setMyClinic] = useState(null)
  const [busyId, setBusyId] = useState('')
  // The clinic whose action is waiting on a yes. One at a time, by id.
  const [confirming, setConfirming] = useState('')
  // Deleting a clinic asks for its NAME to be typed. It removes a dozen people
  // at once, so it is not one tap behind a yes/no the way everything else here
  // is (David's call, 2026-09-16).
  const [typedName, setTypedName] = useState('')
  const [notice, setNotice] = useState('')

  // Two lists off one fetch. admin_list_clinics already orders by newest first,
  // so both keep that order.
  const live = clinics.filter(c => !c.archived_at)
  const archived = clinics.filter(c => c.archived_at)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { clinics: rows } = await api.listAllClinics()
    setClinics(rows)
  }, [])

  useEffect(() => {
    if (authLoading || !session) return
    let active = true
    ;(async () => {
      try {
        const { is_admin } = await api.getAdminMe()
        api.getClinic().then(c => { if (active) setMyClinic(c) }).catch(() => {})
        if (!active) return
        setAllowed(is_admin)
        if (is_admin) await load()
      } catch {
        if (active) setAllowed(false)
      }
    })()
    return () => { active = false }
  }, [authLoading, session, load])

  async function flip(clinic, active) {
    setError('')
    setBusyId(clinic.id)
    try {
      await api.setClinicActive(clinic.id, active)
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  async function recordBaa(clinic) {
    setError('')
    setBusyId(clinic.id)
    try {
      await api.recordClinicBaa(clinic.id, BAA_VERSION)
      setConfirming('')
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  async function archive(clinic, archived) {
    setError('')
    setBusyId(clinic.id)
    try {
      await api.archiveClinic(clinic.id, archived)
      setConfirming('')
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  // ⚠️ THIS DOWNLOADS A CLINIC'S FULL RECORDS, PHI AND ALL. It is the promise
  // the BAA makes ("You can export your clinic's data"), and the one screen in
  // the app that hands a whole clinic's information to a person, so the card
  // says what the file holds before the button is pressed and the database logs
  // that it happened.
  async function exportClinic(clinic) {
    setError('')
    setBusyId(clinic.id)
    try {
      const doc = await api.exportClinic(clinic.id)
      const stamp = new Date().toISOString().slice(0, 10)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `glowpt-${clinic.slug}-${stamp}.json`
      a.click()
      // Revoked on the next tick, not immediately: Safari has not necessarily
      // started reading the blob when click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`Exported ${clinic.name}. The file is in your downloads.`)
    } catch (err) {
      setError(err?.message || 'The export didn’t come through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  async function deleteClinic(clinic) {
    setError('')
    setBusyId(clinic.id)
    try {
      await api.deleteClinic(clinic.id)
      setConfirming('')
      setTypedName('')
      setNotice(`${clinic.name} and everyone in it have been deleted.`)
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  // ⚠️ REFUSED BY THE DATABASE WHILE THE CLINIC IS ON, deliberately: the switch
  // now requires this record, so clearing one underneath a running clinic would
  // leave the state the gate exists to prevent. The message the person sees in
  // that case is the database's own sentence, which says what to do about it.
  async function clearBaa(clinic) {
    setError('')
    setBusyId(clinic.id)
    try {
      await api.clearClinicBaa(clinic.id)
      setConfirming('')
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  if (authLoading) {
    return <AuthShell><LogoMark /><div style={ui.muted}>Loading…</div></AuthShell>
  }
  // Signed-out first: the admin check never runs without a session, so `allowed`
  // would sit at undefined forever and this screen would spin.
  if (!session) return <Navigate to="/login" replace />
  if (allowed === undefined) {
    return <AuthShell><LogoMark /><div style={ui.muted}>Loading…</div></AuthShell>
  }
  if (!allowed) return <Navigate to="/" replace />

  // ONE card, rendered by both lists. They had one chance to drift and this
  // is it: the archived list is the same clinic in a different state, not a
  // second design.
  function renderCard(c) {
        const open = !!c.activated_at
        const busy = busyId === c.id
        return (
          <div key={c.id} style={s.card}>
            <div style={s.cardTop}>
              <div>
                <div style={s.name}>{c.name}</div>
                {/* ⛔ THE SLUG IS NOT SHOWN HERE ANY MORE (David, 2026-09-15):
                    "is there a reason otherwise that I would need to
                    see/use/access the slug? If there's no reason, we can drop
                    the slug it just adds clutter." There is no reason. It was
                    only ever the readable half of the public /join/<slug>
                    address, and that door closed on 2026-09-05. A clinic never
                    sees its slug: no dashboard, no email, no link they send.
                    It stays in the database as the clinic row's internal name,
                    which is all it is now. ⛔ Do not put it back on screen. */}
                <div style={s.slug}>created {when(c.created_at)}</div>
              </div>
              <div style={{ ...s.pill, ...(open ? s.pillOpen : s.pillClosed) }}>
                {open ? 'Open' : 'Closed'}
              </div>
            </div>

            <div style={s.meta}>
              <div><div style={s.metaLabel}>Patients</div>{c.patient_count}</div>
              <div><div style={s.metaLabel}>Staff</div>{c.staff_count}</div>
              <div><div style={s.metaLabel}>Check-Ins, 7 Days</div>{c.checkins_7d}</div>
              <div><div style={s.metaLabel}>Last Check-In</div>{when(c.last_checkin_at)}</div>
              <div><div style={s.metaLabel}>BAA Signed</div>{when(c.baa_signed_at)}</div>
            </div>

            {c.manager_email && (
              <div style={s.contact}>
                {c.manager_name || 'Manager'} ·{' '}
                <a href={`mailto:${c.manager_email}`} style={s.contactLink}>{c.manager_email}</a>
              </div>
            )}

            {/* ⚠️ ONE TAP USED TO WRITE A DATED LEGAL RECORD WITH NO WAY BACK,
                and David wrote a false one on a test clinic before anyone
                noticed. Both of these now ask first, inline rather than in a
                modal: this screen has no modal on purpose (see the overflow-x
                note above), and a question in the row the button was in needs
                no scroll lock, no focus trap and no Escape key. */}
            {confirming === `delete:${c.id}` ? (
              /* ⛔ THE ONE ACTION THAT ASKS YOU TO TYPE. Everything else here is a
                 yes or no; this removes a clinic, its records and every person in it
                 in one go, and it cannot be undone. Typing the name is the friction
                 David asked for. */
              <div style={s.deleteBox}>
                <div style={s.confirmQ}>
                  This deletes {c.name}, its {c.patient_count} patient{c.patient_count === 1 ? '' : 's'}
                  {' '}and {c.staff_count} staff member{c.staff_count === 1 ? '' : 's'}, their check-ins
                  {' '}and their sign-ins. It cannot be undone. Export first if you have not.
                </div>
                <div style={s.fieldLabel}>Type the clinic name to confirm.</div>
                <input style={s.input} value={typedName} placeholder={c.name}
                  onChange={e => setTypedName(e.target.value)} />
                <div style={s.actions}>
                  <button style={{ ...s.btn, ...s.btnDanger, ...(typedName.trim() === c.name ? null : s.btnDisabled) }}
                    disabled={busy || typedName.trim() !== c.name}
                    onClick={() => deleteClinic(c)}>
                    {busy ? 'Deleting…' : 'Delete Permanently'}
                  </button>
                  <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                    onClick={() => { setConfirming(''); setTypedName('') }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : confirming === `archive:${c.id}` ? (
              <div style={s.actions}>
                <div style={s.confirmQ}>
                  Archive {c.name}? It switches off and moves to the foot of this page.
                </div>
                <button style={{ ...s.btn, ...s.btnBaa }} disabled={busy}
                  onClick={() => archive(c, true)}>
                  {busy ? 'Working…' : 'Yes, Archive It'}
                </button>
                <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                  onClick={() => setConfirming('')}>
                  Cancel
                </button>
              </div>
            ) : c.archived_at ? (
              /* An archived clinic has its own three: put it back, take its records
                 out, or destroy it. */
              <div style={s.actions}>
                <button style={{ ...s.btn, ...s.btnOpen }} disabled={busy}
                  onClick={() => archive(c, false)}>
                  {busy ? 'Working…' : 'Restore'}
                </button>
                <button style={{ ...s.btn, ...s.btnBaa }} disabled={busy}
                  onClick={() => exportClinic(c)}>
                  {busy ? 'Working…' : 'Export Records'}
                </button>
                <button style={{ ...s.btn, ...s.btnDanger }} disabled={busy}
                  onClick={() => { setTypedName(''); setConfirming(`delete:${c.id}`) }}>
                  Delete
                </button>
                <div style={s.hint}>The export is a file of everything, patient notes included.</div>
              </div>
            ) : confirming === c.id ? (
              <div style={s.actions}>
                <div style={s.confirmQ}>
                  {c.baa_signed_at
                    ? 'Clear this BAA record? The correction is logged.'
                    : `Record a signed BAA, dated today, version ${BAA_VERSION}?`}
                </div>
                <button style={{ ...s.btn, ...s.btnBaa }} disabled={busy}
                  onClick={() => (c.baa_signed_at ? clearBaa(c) : recordBaa(c))}>
                  {busy ? 'Working…' : (c.baa_signed_at ? 'Yes, Clear It' : 'Yes, Record It')}
                </button>
                <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                  onClick={() => setConfirming('')}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={s.actions}>
                {open ? (
                  <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                    onClick={() => flip(c, false)}>
                    {busy ? 'Working…' : 'Switch Off'}
                  </button>
                ) : (
                  /* ⛔ THE BAA IS THE KEY TO THIS SWITCH. Switching a clinic on
                     is the moment real patient information may flow into it,
                     so the record has to exist first. Disabled rather than
                     hidden, with the reason beside it: an option withheld in
                     silence reads as a missing feature (2026-09-06). The
                     database refuses it too, so this is the explanation, not
                     the guarantee. */
                  <button style={{ ...s.btn, ...s.btnOpen, ...(c.baa_signed_at ? null : s.btnDisabled) }}
                    disabled={busy || !c.baa_signed_at}
                    onClick={() => flip(c, true)}>
                    {busy ? 'Working…' : 'Switch On'}
                  </button>
                )}
                {c.baa_signed_at ? (
                  /* The record STAYS ON SCREEN once made (David: "I just don't
                     want all of it to disappear again"). It reads as a fact
                     with a correction beside it, not as a button that vanished. */
                  <div style={s.baaDone}>
                    BAA Signed {when(c.baa_signed_at)}
                    {' · '}
                    <span role="button" tabIndex={0} style={s.clearLink}
                      onClick={() => setConfirming(c.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConfirming(c.id) } }}>
                      Clear
                    </span>
                  </div>
                ) : (
                  <button style={{ ...s.btn, ...s.btnBaa }} disabled={busy}
                    onClick={() => setConfirming(c.id)}>
                    Record BAA Signed
                  </button>
                )}
                <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                  onClick={() => setConfirming(`archive:${c.id}`)}>
                  Archive
                </button>
                {!open && !c.baa_signed_at && (
                  <div style={s.hint}>Record the signed BAA first.</div>
                )}
              </div>
            )}
          </div>
        )
  }

  return (
    <div style={s.page}>
      {/* This screen's OWN horizontal guard. See the note in Dashboard.jsx: it
          cannot be global, because on <html> it breaks the modal scroll lock.
          Admin has no modal, so it is safe here. */}
      <style>{`html, body { overflow-x: hidden; }`}</style>

      <div style={s.bar}>
        <BrandLockup label="All Clinics" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/dashboard" style={s.navLink}>{myClinic?.name || 'Dashboard'}</Link>
          <button style={s.signOut} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      <div style={s.wrap}>
        <div style={s.h1}>Every Clinic</div>
        <div style={s.sub}>
          A clinic cannot enrol patients or accept check-ins until you switch it on.
        </div>

        {error && <div style={s.error}>{error}</div>}
        {notice && <div style={s.notice}>{notice}</div>}
        {clinics.length === 0 && <div style={s.empty}>No clinics yet.</div>}

        {live.map(c => renderCard(c))}

        {/* ⛔ ARCHIVED CLINICS ARE STILL ON THIS PAGE, at the foot, not hidden
            behind a toggle. An option that vanishes reads as a missing feature,
            which this app has learned twice (the roster's hidden Remove, and the
            BAA record disappearing the moment it was made). */}
        {archived.length > 0 && (
          <>
            <div style={s.archivedHead}>Archived</div>
            <div style={s.sub}>
              Switched off and filed away. Restoring does not switch a clinic back on.
            </div>
            {archived.map(c => renderCard(c))}
          </>
        )}
      </div>
    </div>
  )
}
