import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, BRAND, ui, SECTION_LABEL_SIZE, CARD_LABEL_SIZE } from './AuthShell'
import { fetchClinicData, fetchTherapists, fetchPendingInvites, inviteTherapist, assignTherapist, dischargePatient, restorePatient, buildRoster, clinicStats, relativeDay } from '../lib/clinicData'
import { FEELINGS } from '../lib/feelings'
import { BAA_IS_EXECUTED } from '../lib/legal'
import { CONTACT_EMAIL } from '../lib/marketing'

// The 3-day trend shows the SAME emoji faces the patient taps at check-in (from
// ../lib/feelings) — so staff and patient share one language. "Who needs attention"
// is carried by the flag pills (Low mood / Inactive) shown right next to the name.

const s = {
  // textAlign is declared HERE, not inherited from #root — see the note in
  // src/index.css. This screen is a centred layout; the roster inside it states
  // its own alignment per column and does not rely on this.
  page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', borderBottom: '1px solid rgba(245,239,228,0.08)', flexWrap: 'wrap', gap: 12 },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  wordmark: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: 26, color: '#f5efe4' },
  wordmarkPT: { fontFamily: "'DM Sans', sans-serif", fontStyle: 'normal', fontWeight: 600, color: BRAND },
  clinicName: { fontSize: 14, color: 'rgba(245,239,228,0.6)', borderLeft: '1px solid rgba(245,239,228,0.15)', paddingLeft: 12 },
  signOut: { fontSize: 13, color: 'rgba(245,239,228,0.5)', background: 'transparent', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '7px 14px', cursor: 'pointer' },
  wrap: { maxWidth: 980, margin: '0 auto', padding: '24px clamp(14px, 4vw, 28px) 60px' },
  // On a narrow phone the wide patient table scrolls sideways INSIDE this box, so the
  // rest of the page still fits the screen (prevents the whole page shrinking to fit).
  scroll: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 },
  h1: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 30, marginBottom: 4 },
  sub: { fontSize: 14, color: 'rgba(245,239,228,0.5)', marginBottom: 26 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 },
  tile: { background: '#1a2840', border: '1px solid rgba(245,168,26,0.18)', borderRadius: 6, padding: '16px 18px' },
  tileLabel: { fontSize: CARD_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: 8 },
  tileValue: { fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 400, lineHeight: 1 },
  tileSub: { fontSize: 12, color: 'rgba(245,239,228,0.45)', marginTop: 5, fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  copyBtn: { background: '#F5A81A', color: '#0d1825', border: 'none', borderRadius: 4, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' },
  // Shown to staff while no BAA is executed. It is a NOTICE, not a control —
  // nothing in the app stops a clinic adding real patients today.
  baaBanner: { background: 'rgba(245,168,26,0.09)', border: '1px solid rgba(245,168,26,0.35)', borderRadius: 6, padding: '14px 18px', marginBottom: 24, fontSize: 13.5, lineHeight: 1.6, color: 'rgba(245,239,228,0.85)' },
  baaBannerLead: { fontWeight: 600, color: '#F5A81A' },
  baaBannerLink: { color: '#F5A81A' },
  adminLink: { fontSize: 13, fontWeight: 600, color: '#F5A81A', textDecoration: 'none', border: '1px solid rgba(245,168,26,0.4)', borderRadius: 4, padding: '7px 14px' },
  // Care team (manager)
  care: { background: '#1a2840', border: '1px solid rgba(245,168,26,0.18)', borderRadius: 6, padding: '18px 20px', marginBottom: 28 },
  careHead: { fontSize: SECTION_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: 14 },
  theraRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(245,239,228,0.06)', fontSize: 14.5 },
  theraCount: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  inviteForm: { display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  inviteInput: { flex: '1 1 150px', background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '9px 12px', color: '#f5efe4', fontSize: 14, fontFamily: 'inherit' },
  inviteBtn: { background: '#F5A81A', color: '#0d1825', border: 'none', borderRadius: 4, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' },
  pending: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', marginTop: 12, lineHeight: 1.6 },
  pendingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  resendBtn: { background: 'transparent', border: '1px solid rgba(245,168,26,0.4)', color: '#F5A81A', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  notice: { fontSize: 13, color: '#9bb06a', marginTop: 12 },
  inviteResult: { position: 'relative', marginTop: 14, padding: '14px 16px', background: 'rgba(245,168,26,0.07)', border: '1px solid rgba(245,168,26,0.3)', borderRadius: 6 },
  inviteResultClose: { position: 'absolute', top: 6, right: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'none', border: 'none', borderRadius: 4, color: 'rgba(245,239,228,0.45)', fontSize: 15, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' },
  // ⚠️ overflowWrap is load-bearing: this line ends in an email address, which
  // has no natural break, so at phone width it ran off the panel and under the
  // ✕. paddingRight keeps it clear of that button once it wraps.
  inviteResultHead: { fontSize: 14, lineHeight: 1.5, fontWeight: 600, color: '#f5efe4', marginBottom: 4, paddingRight: 26, overflowWrap: 'anywhere' },
  inviteResultBody: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,239,228,0.65)', marginBottom: 10 },
  inviteLinkRow: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  inviteLinkText: { flex: '1 1 220px', fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.8)', wordBreak: 'break-all' },
  emptyTeam: { fontSize: 13.5, color: 'rgba(245,239,228,0.5)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  greet: { fontSize: 14.5, color: '#FBC02D', fontWeight: 500, marginBottom: 6 },
  sel: { background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '6px 8px', color: '#f5efe4', fontSize: 13, fontFamily: 'inherit', maxWidth: '100%' },
  name: { fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cell: { fontSize: 14, color: 'rgba(245,239,228,0.7)' },
  face: { fontSize: 17, lineHeight: 1 },
  // Each of the 7 trend days is an equal-width slot so emoji (which render wider
  // than their font-size) always fit the column and line up evenly.
  slot: { width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, cursor: 'default' },
  noCheckin: { width: 12, height: 12, borderRadius: '50%', background: 'rgba(245,239,228,0.12)', display: 'inline-block' },
  pill: (kind) => ({ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, marginRight: 6, display: 'inline-block',
    background: kind === 'low' ? 'rgba(192,85,77,0.18)' : 'rgba(245,168,26,0.16)',
    color: kind === 'low' ? '#e79a92' : '#FBC02D', border: `1px solid ${kind === 'low' ? 'rgba(192,85,77,0.4)' : 'rgba(245,168,26,0.4)'}` }),
  ok: { fontSize: 12, color: 'rgba(155,176,106,0.9)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  legend: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '0 16px 16px', fontSize: 12, color: 'rgba(245,239,228,0.55)' },
  legendLabel: { fontSize: 11.5, letterSpacing: '0.01em', color: 'rgba(245,239,228,0.4)', fontWeight: 600 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  rosterHead: { display: 'grid', gap: 12, padding: '0 16px 10px', fontSize: 11.5, letterSpacing: '0.01em', color: 'rgba(245,239,228,0.4)', fontWeight: 600 },
  row: { display: 'grid', gap: 12, alignItems: 'center', background: '#1a2840', border: '1px solid rgba(245,239,228,0.06)', borderRadius: 6, padding: '14px 16px', marginBottom: 8 },
  empty: { background: '#1a2840', border: '1px dashed rgba(245,168,26,0.3)', borderRadius: 8, padding: 32, textAlign: 'center', color: 'rgba(245,239,228,0.6)' },
  // Discharge (soft-delete) controls
  dischargeBtn: { background: 'transparent', border: 'none', padding: '2px 0', color: 'rgba(231,154,146,0.75)', fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em' },
  dischargedWrap: { marginTop: 18 },
  dischargedToggle: { background: 'transparent', border: 'none', color: 'rgba(245,239,228,0.5)', fontSize: 12.5, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' },
  dischargedList: { marginTop: 6, background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: 6, padding: '6px 14px' },
  dischargedRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(245,239,228,0.05)', fontSize: 14, color: 'rgba(245,239,228,0.7)' },
  restoreBtn: { background: 'transparent', border: '1px solid rgba(245,168,26,0.4)', borderRadius: 4, padding: '4px 12px', color: '#FBC02D', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
}

// THE ROSTER'S COLUMNS, DECLARED ONCE. The header cells and the body cells are
// both rendered from this list, so their width and their alignment cannot drift
// apart. They did drift, twice, when the two were written out separately.
//
// ⚠️ EVERY COLUMN STATES ITS OWN `align`, AND THAT IS LOAD-BEARING — DO NOT DROP
// IT AS A NO-OP. `#root` in src/index.css sets `text-align: center`, which every
// screen inherits. A plain text cell inherits it too, but the Patient and
// Therapist cells are FLEX containers, and text-align does not move flex items,
// so those two sat left while their headers sat centre — which read as the
// header being ~115px adrift on Patient and ~240px on Therapist. Stating the
// alignment on BOTH halves, and translating it for flex cells via FLEX_ALIGN,
// makes the roster immune to whatever it inherits.
//
// ORDER (2026-09-05, David): the average mood is one of the most important
// things to see, so it sits immediately beside the name, then the trend and the
// streak (the two engagement signals together), then when they were last seen,
// then who has them. It also puts the average on screen at phone width, where
// the table scrolls sideways and it used to sit three columns out of reach.
//
// WIDTHS ARE CAPPED, NOT `fr`, and they are MEASURED. A bare `fr` grows to fill
// whatever is left, which is what gave the Patient column 264px to hold a 60px
// name. Each cap is the wider of the column's header label and its widest real
// value: Last Check-In 77px header vs 69px "8 days ago", Trend three 20px slots
// plus gaps, Streak 36px header, Avg Mood 57px header. Patient is capped at the
// longest real NAME rather than name-plus-flag-pill, so a flagged patient wraps
// their pill onto a second line — deliberate: it costs nothing to a patient who
// is on track, and a taller row suits one needing attention.
// Re-measure before widening any of these.
const ROSTER_COLUMNS = [
  { key: 'patient',   label: 'Patient',       w: 'minmax(110px,140px)', align: 'center', plain: true },
  { key: 'avg',       label: 'Avg Mood',      w: '64px',                align: 'center' },
  { key: 'trend',     label: '3-Day Trend',   w: '72px',                align: 'center' },
  { key: 'streak',    label: 'Streak',        w: '44px',                align: 'center' },
  { key: 'last',      label: 'Last Check-In', w: '82px',                align: 'center' },
  // Managers assign and discharge; a therapist sees their own caseload and neither.
  { key: 'therapist', label: 'Therapist',     w: 'minmax(150px,170px)', align: 'center', plain: true, managerOnly: true },
]

// text-align does not move flex items, so a flex cell needs the flex equivalent.
// That mismatch IS the bug described above; keep the two in step.
const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' }

function Trend({ last3 }) {
  const days = [...last3]
  while (days.length < 3) days.unshift(null)
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {days.map((f, i) => (
        <span key={i} style={s.slot} title={f ? FEELINGS[f].word : 'No check-in'}>
          {f ? FEELINGS[f].emoji : <span style={s.noCheckin} />}
        </span>
      ))}
    </span>
  )
}

// Flag pills shown inline next to the patient's name. Nothing renders when a
// patient is on track — no news is good news.
function NameFlags({ flags }) {
  if (!flags.length) return null
  return flags.map(f => <span key={f} style={s.pill(f)}>{f === 'low' ? 'Low Mood' : 'Inactive'}</span>)
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
  const [discharged, setDischarged] = useState([])
  const [showDischarged, setShowDischarged] = useState(false)
  const [therapists, setTherapists] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  // Only a platform admin sees the Admin link. The server answers this, and the
  // /admin screen re-checks on its own — this just decides whether to show it.
  const [isAdmin, setIsAdmin] = useState(false)
  const [tName, setTName] = useState('')
  const [tEmail, setTEmail] = useState('')
  const [notice, setNotice] = useState('')
  // ⚠️ ONE MESSAGE SLOT PER CONTROL, DELIBERATELY. Until 2026-09-05 the whole
  // screen shared a single `notice` plus a single `inviteLink`, and BOTH were
  // rendered inside the Care Team card. So inviting a patient put its
  // confirmation two cards further down, below the fold on a phone: the fields
  // just blanked and nothing appeared to happen. Discharge, restore and
  // assignment reported their errors there too, nowhere near the control that
  // caused them. A message belongs beside the thing that produced it.
  const [patientInvite, setPatientInvite] = useState(null) // { url, email, name, sent }
  const [staffInvite, setStaffInvite] = useState(null)     // same shape
  const [patientNotice, setPatientNotice] = useState('')
  const [staffNotice, setStaffNotice] = useState('')
  const [pName, setPName] = useState('')
  const [pEmail, setPEmail] = useState('')

  const isManager = profile?.role === 'manager'
  const staffName = greetingName(profile?.full_name)

  // Load the roster, splitting active patients from discharged (soft-deleted) ones.
  // The roster endpoint writes the HIPAA view_roster audit row server-side, in the
  // same transaction as the read. Reused after a discharge/restore to refresh.
  const loadRoster = useCallback(async () => {
    const { patients, checkins } = await fetchClinicData()
    const active = patients.filter(p => !p.discharged_at)
    setRoster(buildRoster(active, checkins))
    setDischarged(patients.filter(p => p.discharged_at).map(p => ({ id: p.id, name: p.full_name || 'Patient' })))
  }, [])

  useEffect(() => {
    if (!profile?.clinic_id) { setLoading(false); return }
    let active = true
    ;(async () => {
      try {
        const c = await api.getClinic()
        if (!active) return
        setClinic(c)
        await loadRoster()
        if (!active) return
        if (isManager) {
          const [ther, inv] = await Promise.all([fetchTherapists(), fetchPendingInvites()])
          if (!active) return
          setTherapists(ther)
          setInvites(inv)
        }
      } catch (err) {
        console.log('Dashboard load error:', err.message)
      }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [profile, isManager, loadRoster])


  // Ask once whether this staff member is also a platform admin. A plain false
  // on any failure: the link is a convenience, and /admin enforces access itself.
  useEffect(() => {
    if (!profile) return
    let active = true
    api.getAdminMe()
      .then(r => { if (active) setIsAdmin(r?.is_admin === true) })
      .catch(() => { if (active) setIsAdmin(false) })
    return () => { active = false }
  }, [profile])

  // Patient and staff invites share one table by design, so the dashboard has to
  // split them. Until 2026-09-05 an invited PATIENT was listed under Care Team,
  // which is where David spotted Felix.
  const pendingPatients = invites.filter(i => i.role === 'patient')
  const pendingStaff = invites.filter(i => i.role !== 'patient')

  const stats = clinicStats(roster)
  async function handleAssign(patientId, therapistId) {
    const prev = roster
    setRoster(rs => rs.map(r => (r.id === patientId ? { ...r, therapistId } : r))) // optimistic
    try {
      await assignTherapist(patientId, therapistId)
    } catch (err) {
      setRoster(prev); setNotice(`Couldn’t update assignment: ${err.message}`)
    }
  }

  async function handleDischarge(patientId, name) {
    if (!window.confirm(`Discharge ${name}? They’ll be hidden from your roster, but their check-ins are kept and you can restore them anytime.`)) return
    setNotice('')
    try {
      await dischargePatient(patientId)
      await loadRoster()
    } catch (err) {
      setNotice(`Couldn’t discharge ${name}: ${err.message}`)
    }
  }

  async function handleRestore(patientId) {
    setNotice('')
    try {
      await restorePatient(patientId)
      await loadRoster()
    } catch (err) {
      setNotice(`Couldn’t restore: ${err.message}`)
    }
  }

  // Resend an invite that has not been used yet. It reuses the same RPC as the
  // form, which upserts: the person keeps their place in the list and gets a
  // FRESH token, so the old link dies. That matters, because it is also how a
  // link sent to the wrong address is killed.
  const [resending, setResending] = useState('')
  async function resendInvite(inv) {
    const patient = inv.role === 'patient'
    const setNote = patient ? setPatientNotice : setStaffNotice
    const setResult = patient ? setPatientInvite : setStaffInvite
    setNote(''); setResult(null); setResending(inv.email)
    try {
      const res = patient
        ? await api.invitePatient(inv.email, inv.full_name)
        : await api.inviteStaff(inv.email, inv.full_name, inv.role)
      setResult({ url: res.invite_url, email: inv.email, name: inv.full_name || inv.email, sent: !!res.email_sent })
      setInvites(await fetchPendingInvites())
    } catch (err) {
      setNote(`Couldn’t resend to ${inv.email}: ${err.message}`)
    } finally {
      setResending('')
    }
  }

  // One list for both kinds. Each row carries its own Resend, so nobody has to
  // retype a name and address that the clinic has already given us once.
  function PendingList({ people }) {
    if (people.length === 0) return null
    return (
      <div style={s.pending}>
        <strong style={{ color: 'rgba(245,239,228,0.7)' }}>Invited (Waiting for First Sign-In):</strong>
        {people.map(i => (
          <div key={i.email} style={s.pendingRow}>
            <span>{i.full_name || '—'} · {i.email}</span>
            <button type="button" style={s.resendBtn} disabled={resending === i.email}
              onClick={() => resendInvite(i)}>
              {resending === i.email ? 'Sending…' : 'Resend'}
            </button>
          </div>
        ))}
      </div>
    )
  }

  // Rendered directly under whichever form produced it. Both invite forms use
  // this, so the two can never drift apart the way their message slots did.
  function InviteResult({ result, kind }) {
    if (!result) return null
    const dismiss = () => {
      if (kind === 'patient') { setPatientInvite(null); setPatientNotice('') }
      else { setStaffInvite(null); setStaffNotice('') }
    }
    return (
      <div style={s.inviteResult}>
        {/* It had no way out until 2026-09-05: it sat there until you invited
            someone else or reloaded the page. */}
        <button type="button" style={s.inviteResultClose} onClick={dismiss} aria-label="Dismiss">✕</button>
        <div style={s.inviteResultHead}>
          {result.sent
            ? `Invite emailed to ${result.email}.`
            : `Invite created, but the email didn’t send.`}
        </div>
        <div style={s.inviteResultBody}>
          {result.sent
            ? `You can also send ${result.name} this link. It works only for their email address and expires in 14 days.`
            : `Send ${result.name} this link instead. It works only for their email address and expires in 14 days.`}
        </div>
        <div style={s.inviteLinkRow}>
          <div style={s.inviteLinkText}>{result.url}</div>
          <button type="button" style={s.copyBtn}
            onClick={() => {
              navigator.clipboard?.writeText(result.url)
              const msg = 'Invite link copied.'
              if (kind === 'patient') setPatientNotice(msg); else setStaffNotice(msg)
            }}>
            Copy link
          </button>
        </div>
      </div>
    )
  }

  async function handlePatientInvite(e) {
    e.preventDefault()
    setPatientNotice(''); setPatientInvite(null)
    const name = pName.trim(), email = pEmail.trim()
    if (!name) return setPatientNotice('Enter the patient’s name.')
    if (!email) return setPatientNotice('Enter the patient’s email.')
    let res
    try {
      res = await api.invitePatient(email, name)
    } catch (err) {
      return setPatientNotice(`Couldn’t send invite: ${err.message}`)
    }
    setPName(''); setPEmail('')
    setPatientInvite({ url: res.invite_url, email, name, sent: !!res.email_sent })
  }

  async function handleInvite(e) {
    e.preventDefault()
    setStaffNotice(''); setStaffInvite(null)
    const name = tName.trim(), email = tEmail.trim()
    if (!name) return setStaffNotice('Enter the therapist’s name.')
    if (!email) return setStaffNotice('Enter the therapist’s email.')
    let res
    try {
      res = await inviteTherapist(email, name)
    } catch (err) {
      return setStaffNotice(`Couldn’t send invite: ${err.message}`)
    }
    setTName(''); setTEmail('')
    // The link is shown whether or not the email went. The send can fail for
    // reasons that have nothing to do with the invite, which is already saved,
    // and a manager who can see the link is never stuck.
    setStaffInvite({ url: res.invite_url, email, name, sent: !!res.email_sent })
    setInvites(await fetchPendingInvites())
  }

  const Bar = (
    <div style={s.bar}>
      <div style={s.brand}>
        <span style={s.wordmark}>Glow<span style={s.wordmarkPT}>PT</span></span>
        {clinic && <span style={s.clinicName}>{clinic.name}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isAdmin && <Link to="/admin" style={s.adminLink}>All Clinics</Link>}
        <button style={s.signOut} onClick={signOut}>Sign Out</button>
      </div>
    </div>
  )

  if (!profile?.clinic_id) {
    return (
      <AuthShell>
        <LogoMark size={116} />
        <div style={ui.title}>No clinic is linked yet.</div>
        <div style={ui.muted}>Your account isn’t attached to a clinic. If you’re setting one up, use the clinic onboarding page.</div>
        <button style={{ ...ui.btn, maxWidth: 200 }} onClick={signOut}>Sign Out</button>
      </AuthShell>
    )
  }

  const rosterColumns = ROSTER_COLUMNS.filter(c => isManager || !c.managerOnly)
  const rosterCols = rosterColumns.map(c => c.w).join(' ')

  // One cell renderer per column key. Only the CONTENT lives here; the width and
  // the alignment come from ROSTER_COLUMNS, so a cell can never disagree with
  // its own header.
  function rosterCell(c, r) {
    switch (c.key) {
      case 'patient':
        return <div style={{ ...s.name, justifyContent: FLEX_ALIGN[c.align] }}><span>{r.name}</span><NameFlags flags={r.flags} /></div>
      case 'avg':
        return r.avg == null ? '—' : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={s.slot} title={FEELINGS[Math.round(r.avg)].word}>{FEELINGS[Math.round(r.avg)].emoji}</span>{r.avg.toFixed(1)}
          </span>
        )
      case 'trend': return <Trend last3={r.last3} />
      case 'last': return relativeDay(r.lastCheckin)
      case 'streak': return r.streak > 0 ? `${r.streak}🔥` : '—'
      case 'therapist':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: FLEX_ALIGN[c.align] }}>
            <select style={s.sel} value={r.therapistId || ''} onChange={e => handleAssign(r.id, e.target.value || null)}>
              <option value="">Unassigned</option>
              {therapists.map(t => <option key={t.id} value={t.id}>{t.full_name || 'Therapist'}</option>)}
            </select>
            <button style={s.dischargeBtn} onClick={() => handleDischarge(r.id, r.name)}>Discharge</button>
          </div>
        )
      default: return null
    }
  }

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,1,400&family=DM+Sans:wght@400;500;600&display=swap'); * { box-sizing: border-box; } html { -webkit-text-size-adjust: 100%; } html, body { margin: 0; background: #0d1825; overflow-x: hidden; }`}</style>
      {Bar}
      <div style={s.wrap}>
        {/* Two different facts, so two different messages. A closed clinic is a
            hard stop — its /join link genuinely refuses patients — and saying
            "demo data only" there would leave a manager wondering why nobody
            can sign up.

            === null, NOT !clinic.activated_at. Netlify ships this file on push
            while the API ships on a separate cdk deploy, so for a while the old
            API returns no activated_at at all. undefined would then read as
            "closed" and tell every live clinic, Riverside included, that it had
            been switched off. Only an explicit null means closed. */}
        {clinic && clinic.activated_at === null ? (
          <div style={s.baaBanner}>
            <span style={s.baaBannerLead}>Your clinic isn’t switched on yet. </span>
            Patients can’t join or check in until it is. We’ll switch it on once the Business
            Associate Agreement is signed. Email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={s.baaBannerLink}>{CONTACT_EMAIL}</a> to get that started.
          </div>
        ) : !BAA_IS_EXECUTED && (
          <div style={s.baaBanner}>
            <span style={s.baaBannerLead}>Demo data only for now. </span>
            You’ll review and sign the full Business Associate Agreement before any real patient
            information enters GlowPT. Email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={s.baaBannerLink}>{CONTACT_EMAIL}</a> to get that started.
          </div>
        )}

        {staffName && <div style={s.greet}>Welcome back, {staffName}</div>}
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
              <div style={s.tile}><div style={s.tileLabel}>Active This Week</div><div style={s.tileValue}>{stats.active}</div><div style={s.tileSub}>checked in</div></div>
              <div style={s.tile}><div style={s.tileLabel}>Engagement</div><div style={s.tileValue}>{stats.engagement}%</div><div style={s.tileSub}>of roster</div></div>
              <div style={s.tile}><div style={s.tileLabel}>Need Attention</div><div style={{ ...s.tileValue, color: stats.atRisk ? '#FBC02D' : '#f5efe4' }}>{stats.atRisk}</div><div style={s.tileSub}>flagged</div></div>
            </div>

            {/* Invites work whichever way the switch is set. */}
            <div style={s.care}>
              <div style={s.careHead}>Invite a Patient</div>
              <form onSubmit={handlePatientInvite} style={s.inviteForm}>
                {/* Typing the next patient clears the last result, so the card
                    is never showing one person's link above another's form. */}
                <input style={s.inviteInput} placeholder="Patient name" value={pName}
                  onChange={e => { setPName(e.target.value); setPatientInvite(null); setPatientNotice('') }} autoComplete="name" />
                <input style={s.inviteInput} placeholder="Patient email" type="email" value={pEmail}
                  onChange={e => { setPEmail(e.target.value); setPatientInvite(null); setPatientNotice('') }}
                  autoComplete="off" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button style={s.inviteBtn} type="submit">Invite Patient →</button>
              </form>
              {patientNotice && <div style={s.notice}>{patientNotice}</div>}
              <InviteResult result={patientInvite} kind="patient" />
              <PendingList people={pendingPatients} />
            </div>

            {/* Care team — invite therapists and see how many patients each carries. */}
            <div style={s.care}>
              <div style={s.careHead}>Care Team</div>
              {therapists.length === 0 && pendingStaff.length === 0 && (
                <div style={s.emptyTeam}>No therapists yet. Invite one below, and once they sign in you can assign patients to them.</div>
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
                <input style={s.inviteInput} placeholder="Therapist name" value={tName}
                  onChange={e => { setTName(e.target.value); setStaffInvite(null); setStaffNotice('') }} autoComplete="name" />
                <input style={s.inviteInput} placeholder="Therapist email" type="email" value={tEmail}
                  onChange={e => { setTEmail(e.target.value); setStaffInvite(null); setStaffNotice('') }}
                  autoComplete="off" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button style={s.inviteBtn} type="submit">Invite Therapist →</button>
              </form>
              {staffNotice && <div style={s.notice}>{staffNotice}</div>}
              <InviteResult result={staffInvite} kind="staff" />
              <PendingList people={pendingStaff} />
            </div>
          </>
        )}

        {!loading && roster.length === 0 && (
          <div style={s.empty}>
            {isManager
              ? 'No patients yet. Invite your first patient above and they will get a link by email.'
              : 'No patients assigned to you yet. Your clinic manager assigns patients to therapists.'}
          </div>
        )}

        {/* Assignment, discharge and restore all report here, beside the roster
            they act on. This used to land in the Care Team card further down. */}
        {notice && <div style={s.notice}>{notice}</div>}

        {!loading && roster.length > 0 && (
          <>
            <div style={s.legend}>
              <span style={s.legendLabel}>3-Day Trend · Daily Feeling</span>
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} style={s.legendItem}>
                  <span style={s.face}>{FEELINGS[n].emoji}</span> {FEELINGS[n].word}
                </span>
              ))}
              <span style={s.legendItem}><span style={s.noCheckin} /> No check-in</span>
            </div>
            <div style={s.scroll}>
              <div style={{ minWidth: isManager ? 680 : 560 }}>
                <div style={{ ...s.rosterHead, gridTemplateColumns: rosterCols }}>
                  {rosterColumns.map(c => <div key={c.key} style={{ textAlign: c.align }}>{c.label}</div>)}
                </div>
                {roster.map(r => (
                  <div key={r.id} style={{ ...s.row, gridTemplateColumns: rosterCols }}>
                    {rosterColumns.map(c => (
                      <div key={c.key} style={{ ...(c.plain ? null : s.cell), textAlign: c.align }}>
                        {rosterCell(c, r)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {isManager && discharged.length > 0 && (
          <div style={s.dischargedWrap}>
            <button style={s.dischargedToggle} onClick={() => setShowDischarged(v => !v)}>
              {showDischarged ? '▾' : '▸'} Discharged ({discharged.length})
            </button>
            {showDischarged && (
              <div style={s.dischargedList}>
                {discharged.map(d => (
                  <div key={d.id} style={s.dischargedRow}>
                    <span>{d.name}</span>
                    <button style={s.restoreBtn} onClick={() => handleRestore(d.id)}>Restore</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
