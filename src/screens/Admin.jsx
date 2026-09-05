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
      await load()
    } catch (err) {
      setError(err?.message || 'That didn’t go through. Try again.')
    } finally {
      setBusyId('')
    }
  }

  if (authLoading) {
    return <AuthShell><LogoMark size={116} /><div style={ui.muted}>Loading…</div></AuthShell>
  }
  // Signed-out first: the admin check never runs without a session, so `allowed`
  // would sit at undefined forever and this screen would spin.
  if (!session) return <Navigate to="/login" replace />
  if (allowed === undefined) {
    return <AuthShell><LogoMark size={116} /><div style={ui.muted}>Loading…</div></AuthShell>
  }
  if (!allowed) return <Navigate to="/" replace />

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,1,400&family=DM+Sans:wght@400;500;600&display=swap'); * { box-sizing: border-box; } html, body { margin: 0; background: #0d1825; overflow-x: hidden; }`}</style>

      <div style={s.bar}>
        <BrandLockup label="All Clinics" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/dashboard" style={s.navLink}>{myClinic?.name || 'Dashboard'}</Link>
          <button style={s.signOut} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      <div style={s.wrap}>
        <div style={s.h1}>Every clinic</div>
        <div style={s.sub}>
          A clinic cannot enrol patients or accept check-ins until you switch it on.
        </div>

        {error && <div style={s.error}>{error}</div>}
        {clinics.length === 0 && <div style={s.empty}>No clinics yet.</div>}

        {clinics.map(c => {
          const open = !!c.activated_at
          const busy = busyId === c.id
          return (
            <div key={c.id} style={s.card}>
              <div style={s.cardTop}>
                <div>
                  <div style={s.name}>{c.name}</div>
                  <div style={s.slug}>/join/{c.slug} · created {when(c.created_at)}</div>
                </div>
                <div style={{ ...s.pill, ...(open ? s.pillOpen : s.pillClosed) }}>
                  {open ? 'Open' : 'Closed'}
                </div>
              </div>

              <div style={s.meta}>
                <div><div style={s.metaLabel}>Patients</div>{c.patient_count}</div>
                <div><div style={s.metaLabel}>Staff</div>{c.staff_count}</div>
                <div><div style={s.metaLabel}>Check-ins, 7 days</div>{c.checkins_7d}</div>
                <div><div style={s.metaLabel}>Last check-in</div>{when(c.last_checkin_at)}</div>
                <div><div style={s.metaLabel}>BAA signed</div>{when(c.baa_signed_at)}</div>
              </div>

              {c.manager_email && (
                <div style={s.contact}>
                  {c.manager_name || 'Manager'} ·{' '}
                  <a href={`mailto:${c.manager_email}`} style={s.contactLink}>{c.manager_email}</a>
                </div>
              )}

              <div style={s.actions}>
                {open ? (
                  <button style={{ ...s.btn, ...s.btnClose }} disabled={busy}
                    onClick={() => flip(c, false)}>
                    {busy ? 'Working…' : 'Switch Off'}
                  </button>
                ) : (
                  <button style={{ ...s.btn, ...s.btnOpen }} disabled={busy}
                    onClick={() => flip(c, true)}>
                    {busy ? 'Working…' : 'Switch On'}
                  </button>
                )}
                {!c.baa_signed_at && (
                  <button style={{ ...s.btn, ...s.btnBaa }} disabled={busy}
                    onClick={() => recordBaa(c)}>
                    Record BAA Signed
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
