import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, ui } from './AuthShell'
import { fetchClinicData, fetchTherapists, fetchPendingInvites, inviteTherapist, assignTherapist, buildRoster, clinicStats, relativeDay } from '../lib/clinicData'
import QRCode from 'qrcode'

// 1 red → 5 green. "Good" (4) is a light lime, "Great" (5) a deeper emerald, so the
// two positive dots read as clearly different colors (they were too-similar greens before).
const FEELING_COLOR = { 1: '#c0554d', 2: '#d07d45', 3: '#c8861d', 4: '#b6c24a', 5: '#2fa06d' }

const s = {
  page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif" },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', borderBottom: '1px solid rgba(245,239,228,0.08)', flexWrap: 'wrap', gap: 12 },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  wordmark: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: 26, color: '#f5efe4' },
  wordmarkPT: { fontFamily: "'DM Sans', sans-serif", fontStyle: 'normal', fontWeight: 600, color: '#c8861d' },
  clinicName: { fontSize: 14, color: 'rgba(245,239,228,0.6)', borderLeft: '1px solid rgba(245,239,228,0.15)', paddingLeft: 12 },
  signOut: { fontSize: 13, color: 'rgba(245,239,228,0.5)', background: 'transparent', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '7px 14px', cursor: 'pointer' },
  wrap: { maxWidth: 980, margin: '0 auto', padding: '24px clamp(14px, 4vw, 28px) 60px' },
  // On a narrow phone the wide patient table scrolls sideways INSIDE this box, so the
  // rest of the page still fits the screen (prevents the whole page shrinking to fit).
  scroll: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 },
  h1: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 30, marginBottom: 4 },
  sub: { fontSize: 14, color: 'rgba(245,239,228,0.5)', marginBottom: 26 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 },
  tile: { background: '#1a2840', border: '1px solid rgba(200,134,29,0.18)', borderRadius: 6, padding: '16px 18px' },
  tileLabel: { fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: 8 },
  tileValue: { fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 400, lineHeight: 1 },
  tileSub: { fontSize: 12, color: 'rgba(245,239,228,0.45)', marginTop: 5, fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  linkCard: { background: 'linear-gradient(135deg, rgba(200,134,29,0.1), rgba(13,24,37,0))', border: '1px solid rgba(200,134,29,0.25)', borderRadius: 6, padding: '18px 20px', marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  linkLabel: { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: 6 },
  linkUrl: { fontSize: 15, color: '#f5efe4', wordBreak: 'break-all' },
  copyBtn: { background: '#c8861d', color: '#0d1825', border: 'none', borderRadius: 4, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' },
  qrCard: { background: '#1a2840', border: '1px solid rgba(200,134,29,0.2)', borderRadius: 6, padding: 20, marginBottom: 28, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' },
  qrImg: { width: 116, height: 116, borderRadius: 6, background: '#fff', padding: 6, flexShrink: 0 },
  qrLabel: { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: 6 },
  qrHint: { fontSize: 13.5, color: 'rgba(245,239,228,0.65)', lineHeight: 1.55, marginBottom: 12, maxWidth: '46ch' },
  qrDownload: { display: 'inline-block', background: '#c8861d', color: '#0d1825', textDecoration: 'none', fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 4 },
  // Care team (manager)
  care: { background: '#1a2840', border: '1px solid rgba(200,134,29,0.18)', borderRadius: 6, padding: '18px 20px', marginBottom: 28 },
  careHead: { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: 14 },
  theraRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(245,239,228,0.06)', fontSize: 14.5 },
  theraCount: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  inviteForm: { display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  inviteInput: { flex: '1 1 150px', background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '9px 12px', color: '#f5efe4', fontSize: 14, fontFamily: 'inherit' },
  inviteBtn: { background: '#c8861d', color: '#0d1825', border: 'none', borderRadius: 4, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' },
  pending: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', marginTop: 12, lineHeight: 1.6 },
  notice: { fontSize: 13, color: '#9bb06a', marginTop: 12 },
  emptyTeam: { fontSize: 13.5, color: 'rgba(245,239,228,0.5)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  greet: { fontSize: 14.5, color: '#e0a035', fontWeight: 500, marginBottom: 6 },
  sel: { background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '6px 8px', color: '#f5efe4', fontSize: 13, fontFamily: 'inherit', maxWidth: '100%' },
  name: { fontSize: 15, fontWeight: 500 },
  cell: { fontSize: 14, color: 'rgba(245,239,228,0.7)' },
  dot: (f) => ({ width: 12, height: 12, borderRadius: '50%', background: f ? FEELING_COLOR[f] : 'rgba(245,239,228,0.12)', display: 'inline-block' }),
  pill: (kind) => ({ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, marginRight: 6, display: 'inline-block',
    background: kind === 'low' ? 'rgba(192,85,77,0.18)' : 'rgba(200,134,29,0.16)',
    color: kind === 'low' ? '#e79a92' : '#e0a035', border: `1px solid ${kind === 'low' ? 'rgba(192,85,77,0.4)' : 'rgba(200,134,29,0.4)'}` }),
  ok: { fontSize: 12, color: 'rgba(155,176,106,0.9)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  legend: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '0 16px 16px', fontSize: 12, color: 'rgba(245,239,228,0.55)' },
  legendLabel: { fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,239,228,0.4)', fontWeight: 600 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  rosterHead: { display: 'grid', gap: 12, padding: '0 16px 10px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,239,228,0.4)', fontWeight: 600 },
  row: { display: 'grid', gap: 12, alignItems: 'center', background: '#1a2840', border: '1px solid rgba(245,239,228,0.06)', borderRadius: 6, padding: '14px 16px', marginBottom: 8 },
  empty: { background: '#1a2840', border: '1px dashed rgba(200,134,29,0.3)', borderRadius: 8, padding: 32, textAlign: 'center', color: 'rgba(245,239,228,0.6)' },
}

// Roster grid columns — managers get an extra "Therapist" (assign) column.
const COLS_MANAGER = '1.5fr 0.9fr 0.6fr 1.1fr 0.5fr 0.95fr 1.1fr'
const COLS_THERAPIST = '1.6fr 1fr 0.8fr 1.4fr 0.8fr 1.2fr'

function Trend({ last7 }) {
  const dots = [...last7]
  while (dots.length < 7) dots.unshift(null)
  return <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{dots.map((f, i) => <span key={i} style={s.dot(f)} />)}</span>
}

function Flags({ flags }) {
  if (!flags.length) return <span style={s.ok}>On track</span>
  return <span>{flags.map(f => <span key={f} style={s.pill(f)}>{f === 'low' ? 'Low mood' : 'Inactive'}</span>)}</span>
}

// Friendly greeting name. Keep a leading title with the name ("Dr. Sam"), otherwise
// just the first name ("David") so staff are greeted personally, not formally.
const TITLES = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'prof', 'prof.'])
function greetingName(full) {
  if (!full) return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length > 1 && TITLES.has(parts[0].toLowerCase())) return `${parts[0]} ${parts[1]}`
  return parts[0]
}

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const [clinic, setClinic] = useState(null)
  const [roster, setRoster] = useState([])
  const [therapists, setTherapists] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [qrUrl, setQrUrl] = useState('')
  const [tName, setTName] = useState('')
  const [tEmail, setTEmail] = useState('')
  const [notice, setNotice] = useState('')
  const logged = useRef(false)

  const isManager = profile?.role === 'manager'

  useEffect(() => {
    if (!profile?.clinic_id) { setLoading(false); return }
    let active = true
    ;(async () => {
      const { data: c } = await supabase.from('clinics').select('id, name, slug').eq('id', profile.clinic_id).single()
      const { patients, checkins } = await fetchClinicData(profile.clinic_id)
      if (!active) return
      setClinic(c)
      setRoster(buildRoster(patients, checkins))
      if (isManager) {
        const [ther, inv] = await Promise.all([fetchTherapists(profile.clinic_id), fetchPendingInvites(profile.clinic_id)])
        if (!active) return
        setTherapists(ther)
        setInvites(inv)
      }
      setLoading(false)
      if (!logged.current) {
        logged.current = true
        supabase.from('access_log').insert({ actor_id: user.id, action: 'view_roster', clinic_id: profile.clinic_id })
      }
    })()
    return () => { active = false }
  }, [profile, user, isManager])

  // Generate a printable QR code of the clinic's patient invite link.
  useEffect(() => {
    if (!clinic) { setQrUrl(''); return }
    const url = `${window.location.origin}/join/${clinic.slug}`
    QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: '#0d1825', light: '#ffffff' } })
      .then(setQrUrl).catch(() => setQrUrl(''))
  }, [clinic])

  const stats = clinicStats(roster)
  const joinUrl = clinic ? `${window.location.origin}/join/${clinic.slug}` : ''

  function copyLink() {
    navigator.clipboard?.writeText(joinUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleAssign(patientId, therapistId) {
    const prev = roster
    setRoster(rs => rs.map(r => (r.id === patientId ? { ...r, therapistId } : r))) // optimistic
    const { error } = await assignTherapist(patientId, therapistId)
    if (error) { setRoster(prev); setNotice(`Couldn’t update assignment: ${error.message}`) }
  }

  async function handleInvite(e) {
    e.preventDefault()
    setNotice('')
    const name = tName.trim(), email = tEmail.trim()
    if (!name) return setNotice('Enter the therapist’s name.')
    if (!email) return setNotice('Enter the therapist’s email.')
    const { error } = await inviteTherapist(email, name)
    if (error) return setNotice(`Couldn’t send invite: ${error.message}`)
    setTName(''); setTEmail('')
    setNotice(`Invited ${name}. They’ll appear as a therapist once they sign in at the login page with ${email}.`)
    setInvites(await fetchPendingInvites(profile.clinic_id))
  }

  const Bar = (
    <div style={s.bar}>
      <div style={s.brand}>
        <span style={s.wordmark}>Glow<span style={s.wordmarkPT}>PT</span></span>
        {clinic && <span style={s.clinicName}>{clinic.name}</span>}
      </div>
      <button style={s.signOut} onClick={signOut}>Sign out</button>
    </div>
  )

  if (!profile?.clinic_id) {
    return (
      <AuthShell>
        <LogoMark size={160} />
        <div style={ui.title}>No clinic linked yet</div>
        <div style={ui.muted}>Your account isn’t attached to a clinic. If you’re setting one up, use the clinic onboarding page.</div>
        <button style={{ ...ui.btn, maxWidth: 200 }} onClick={signOut}>Sign out</button>
      </AuthShell>
    )
  }

  const rosterCols = isManager ? COLS_MANAGER : COLS_THERAPIST

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,1,400&family=DM+Sans:wght@400;500;600&display=swap'); * { box-sizing: border-box; } html { -webkit-text-size-adjust: 100%; } html, body { margin: 0; background: #0d1825; overflow-x: hidden; }`}</style>
      {Bar}
      <div style={s.wrap}>
        {greetingName(profile?.full_name) && <div style={s.greet}>Welcome back, {greetingName(profile?.full_name)}</div>}
        <div style={s.h1}>{isManager ? 'Clinic overview' : 'Your patients'}</div>
        <div style={s.sub}>
          {loading ? 'Loading…' : isManager
            ? 'Engagement across your patient roster this week.'
            : 'How your assigned patients are doing between visits. Flagged patients first.'}
        </div>

        {isManager && !loading && (
          <>
            <div style={s.tiles}>
              <div style={s.tile}><div style={s.tileLabel}>Patients</div><div style={s.tileValue}>{stats.total}</div><div style={s.tileSub}>enrolled</div></div>
              <div style={s.tile}><div style={s.tileLabel}>Active this week</div><div style={s.tileValue}>{stats.active}</div><div style={s.tileSub}>checked in</div></div>
              <div style={s.tile}><div style={s.tileLabel}>Engagement</div><div style={s.tileValue}>{stats.engagement}%</div><div style={s.tileSub}>of roster</div></div>
              <div style={s.tile}><div style={s.tileLabel}>Need attention</div><div style={{ ...s.tileValue, color: stats.atRisk ? '#e0a035' : '#f5efe4' }}>{stats.atRisk}</div><div style={s.tileSub}>flagged</div></div>
            </div>

            <div style={s.linkCard}>
              <div>
                <div style={s.linkLabel}>Your patient invite link</div>
                <div style={s.linkUrl}>{joinUrl}</div>
              </div>
              <button style={s.copyBtn} onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>

            {qrUrl && (
              <div style={s.qrCard}>
                <img src={qrUrl} alt="Patient sign-up QR code" style={s.qrImg} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={s.qrLabel}>Patient sign-up QR</div>
                  <div style={s.qrHint}>Print this for your front desk and treatment rooms. Patients scan it with their phone camera to join — no links to send.</div>
                  <a href={qrUrl} download={`glowpt-${clinic?.slug || 'clinic'}-qr.png`} style={s.qrDownload}>Download QR ↓</a>
                </div>
              </div>
            )}

            {/* Care team — invite therapists and see how many patients each carries. */}
            <div style={s.care}>
              <div style={s.careHead}>Care team</div>
              {therapists.length === 0 && invites.length === 0 && (
                <div style={s.emptyTeam}>No therapists yet. Invite one below — once they sign in, you can assign patients to them.</div>
              )}
              {therapists.map(t => {
                const load = roster.filter(r => r.therapistId === t.id).length
                return (
                  <div key={t.id} style={s.theraRow}>
                    <span>{t.full_name || 'Therapist'}</span>
                    <span style={s.theraCount}>{load} {load === 1 ? 'patient' : 'patients'}</span>
                  </div>
                )
              })}
              <form onSubmit={handleInvite} style={s.inviteForm}>
                <input style={s.inviteInput} placeholder="Therapist name" value={tName} onChange={e => setTName(e.target.value)} autoComplete="name" />
                <input style={s.inviteInput} placeholder="Therapist email" type="email" value={tEmail} onChange={e => setTEmail(e.target.value)}
                  autoComplete="off" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button style={s.inviteBtn} type="submit">Invite therapist →</button>
              </form>
              {notice && <div style={s.notice}>{notice}</div>}
              {invites.length > 0 && (
                <div style={s.pending}>
                  <strong style={{ color: 'rgba(245,239,228,0.7)' }}>Pending (waiting for first sign-in):</strong><br />
                  {invites.map(i => `${i.full_name || '—'} · ${i.email}`).join('  ·  ')}
                </div>
              )}
            </div>
          </>
        )}

        {!loading && roster.length === 0 && (
          <div style={s.empty}>
            {isManager
              ? 'No patients yet. Share your invite link above to get your first patients checking in.'
              : 'No patients assigned to you yet. Your clinic manager assigns patients to therapists.'}
          </div>
        )}

        {!loading && roster.length > 0 && (
          <>
            <div style={s.legend}>
              <span style={s.legendLabel}>7-day trend — daily feeling</span>
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} style={s.legendItem}>
                  <span style={s.dot(n)} /> {['Really tough', 'Hard', 'Okay', 'Good', 'Great'][n - 1]}
                </span>
              ))}
              <span style={s.legendItem}><span style={s.dot(null)} /> No check-in</span>
            </div>
            <div style={s.scroll}>
              <div style={{ minWidth: isManager ? 700 : 560 }}>
                <div style={{ ...s.rosterHead, gridTemplateColumns: rosterCols }}>
                  <div>Patient</div><div>Last check-in</div><div>Streak</div><div>7-day trend</div><div>Avg</div><div>Status</div>
                  {isManager && <div>Therapist</div>}
                </div>
                {roster.map(r => (
                  <div key={r.id} style={{ ...s.row, gridTemplateColumns: rosterCols }}>
                    <div style={s.name}>{r.name}</div>
                    <div style={s.cell}>{relativeDay(r.lastCheckin)}</div>
                    <div style={s.cell}>{r.streak > 0 ? `${r.streak}🔥` : '—'}</div>
                    <div><Trend last7={r.last7} /></div>
                    <div style={s.cell}>{r.avg != null ? r.avg.toFixed(1) : '—'}</div>
                    <div><Flags flags={r.flags} /></div>
                    {isManager && (
                      <div>
                        <select style={s.sel} value={r.therapistId || ''} onChange={e => handleAssign(r.id, e.target.value || null)}>
                          <option value="">Unassigned</option>
                          {therapists.map(t => <option key={t.id} value={t.id}>{t.full_name || 'Therapist'}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
