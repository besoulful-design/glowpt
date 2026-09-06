import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../auth'
import { AuthShell, LogoMark, BrandLockup, BRAND, ui, SECTION_LABEL_SIZE, CARD_LABEL_SIZE } from './AuthShell'
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
  // Sign-in link card. The message is shown because it is what gets copied:
  // a clipboard whose contents are a mystery is not a thing to hand a patient.
  signInLead: { fontSize: 13.5, lineHeight: 1.6, color: 'rgba(245,239,228,0.55)', marginBottom: 14, textAlign: 'left' },
  signInBox: { fontSize: 13.5, lineHeight: 1.65, color: '#f5efe4', background: '#0d1825', border: '1px solid rgba(245,239,228,0.12)', borderRadius: 4, padding: '12px 14px', textAlign: 'left', overflowWrap: 'anywhere', userSelect: 'text' },
  signInRow: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 },
  signInHint: { fontSize: 12.5, color: 'rgba(245,239,228,0.4)', textAlign: 'left' },
  inviteInput: { flex: '1 1 150px', background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '9px 12px', color: '#f5efe4', fontSize: 14, fontFamily: 'inherit' },
  inviteBtn: { background: '#F5A81A', color: '#0d1825', border: 'none', borderRadius: 4, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' },
  pending: { fontSize: 12.5, color: 'rgba(245,239,228,0.5)', marginTop: 12, lineHeight: 1.6 },
  pendingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  // An email address has no natural break opportunity, so it needs telling that
  // it may break anywhere or it runs off the card at phone width.
  pendingWho: { flex: '1 1 180px', textAlign: 'left', overflowWrap: 'anywhere' },
  // Filled, unlike Resend and Cancel beside it: of the three this is the one a
  // manager reaches for most, and the only one that changes nothing.
  copyLinkBtn: { background: '#F5A81A', color: '#0d1825', border: '1px solid #F5A81A', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  resendBtn: { background: 'transparent', border: '1px solid rgba(245,168,26,0.4)', color: '#F5A81A', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  notice: { fontSize: 13, color: '#9bb06a', marginTop: 12 },
  // ⚠️ A PROBLEM MUST NOT RENDER IN THE SUCCESS GREEN. This slot now carries
  // "the email didn't send" and the form's own validation, and saying that in
  // the same colour as "Invite emailed" tells the reader the opposite of what
  // happened. Same red as the Low mood pill, so the page has one word for bad.
  noticeBad: { fontSize: 13, color: '#e79a92', marginTop: 12 },
  // Only shown when the clipboard refused: the manager copies it by hand.
  noticeLink: { fontSize: 12.5, lineHeight: 1.5, color: 'rgba(245,239,228,0.8)', marginTop: 6, wordBreak: 'break-all', textAlign: 'left' },
  emptyTeam: { fontSize: 13.5, color: 'rgba(245,239,228,0.5)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  greet: { fontSize: 14.5, color: '#FBC02D', fontWeight: 500, marginBottom: 6 },
  sel: { background: '#0d1825', border: '1px solid rgba(245,239,228,0.15)', borderRadius: 4, padding: '6px 8px', color: '#f5efe4', fontSize: 13, fontFamily: 'inherit', maxWidth: '100%' },
  name: { fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cell: { fontSize: 14, color: 'rgba(245,239,228,0.7)' },
  face: { fontSize: 17, lineHeight: 1 },
  // Each of the 7 trend days is an equal-width slot so emoji (which render wider
  // than their font-size) always fit the column and line up evenly.
  slot: { width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, cursor: 'default' },
  noCheckin: { width: 12, height: 12, borderRadius: '50%', background: 'rgba(245,239,228,0.12)', display: 'inline-block', verticalAlign: 'middle' },
  pill: (kind) => ({ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, marginRight: 6, display: 'inline-block',
    background: kind === 'low' ? 'rgba(192,85,77,0.18)' : 'rgba(245,168,26,0.16)',
    color: kind === 'low' ? '#e79a92' : '#FBC02D', border: `1px solid ${kind === 'low' ? 'rgba(192,85,77,0.4)' : 'rgba(245,168,26,0.4)'}` }),
  ok: { fontSize: 12, color: 'rgba(155,176,106,0.9)', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
  // ⚠️ NOT A FLEX ROW, DELIBERATELY -- see the note at the render. Flex can only
  // wrap at its gaps; this needs to wrap between words. textAlign is stated
  // because s.page centres the screen and inline text would otherwise follow it.
  // lineHeight is stated because the 17px faces and the 12px dot share the line
  // with 12px text, and because body sets an ABSOLUTE 26.1px that would inherit
  // here unchanged (the trap recorded for the landing footer on 2026-09-03).
  legend: { padding: '0 16px 16px', fontSize: 12, lineHeight: 1.9, color: 'rgba(245,239,228,0.55)', textAlign: 'left' },
  legendLabel: { fontSize: 11.5, letterSpacing: '0.01em', color: 'rgba(245,239,228,0.4)', fontWeight: 600 },
  legendEnd: { color: 'rgba(245,239,228,0.45)' },
  // Tight gap on purpose: the five read as one scale, not five separate items.
  // Nowrap by nature (inline-flex), so the ramp never breaks across two lines.
  legendFaces: { display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' },
  // marginLeft replaces the 16px flex gap this item used to get for free.
  // Without it "Feeling great" and "No check-in" run together on one line.
  legendNone: { whiteSpace: 'nowrap', marginLeft: 16 },
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
  // Permanent actions are quieter than the reversible ones beside them, on
  // purpose: Restore is the button you want people to reach for.
  removeBtn: { background: 'transparent', border: '1px solid rgba(231,154,146,0.35)', borderRadius: 4, padding: '4px 12px', color: 'rgba(231,154,146,0.85)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  undoLink: { background: 'transparent', border: 'none', color: '#FBC02D', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  removeConfirm: { background: 'rgba(231,154,146,0.06)', border: '1px solid rgba(231,154,146,0.35)', borderRadius: 6, padding: '14px 16px', margin: '4px 0 10px', textAlign: 'left' },
  removeConfirmHead: { fontSize: 14.5, fontWeight: 600, color: 'rgba(231,154,146,0.95)', marginBottom: 6 },
  removeConfirmBody: { fontSize: 13, lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', marginBottom: 12 },
  removeConfirmLabel: { display: 'block', fontSize: 12.5, color: 'rgba(245,239,228,0.5)', marginBottom: 6 },
  removeConfirmInput: { width: '100%', maxWidth: 260, background: 'rgba(245,239,228,0.06)', border: '1px solid rgba(245,168,26,0.3)', borderRadius: 4, padding: '9px 12px', color: '#f5efe4', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  cancelBtn: { background: 'transparent', border: '1px solid rgba(231,154,146,0.35)', color: 'rgba(231,154,146,0.85)', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
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
  // Managers assign and archive; a therapist sees their own caseload and neither.
  { key: 'therapist', label: 'Therapist',     w: 'minmax(150px,170px)', align: 'center', plain: true, managerOnly: true },
  // ⚠️ ARCHIVE IS ITS OWN COLUMN, NOT A LINK UNDER THE THERAPIST DROPDOWN (David,
  // 2026-09-06: "that looks crazy"). It was stacked under the select because both
  // are manager-only, which is a reason they share a ROLE, not a reason they share
  // a CELL: one sets who treats the patient, the other takes them off the roster.
  // Blank header on purpose -- an action column labelled "Archive" above a button
  // reading "Archive" is noise. 92px is the button's own width plus breathing room.
  { key: 'archive',   label: '',              w: '92px',                align: 'center', plain: true, managerOnly: true },
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

// Module scope, not nested inside Dashboard: a component declared inside another
// is a NEW component type on every render, so React unmounts and remounts it
// (losing focus and any state) rather than updating it. It is also what makes it
// renderable on its own for a visual check.
//
// One list for both kinds. Each row carries its own Copy Link, Resend and
// Cancel, so nobody has to retype a name and address the clinic has already
// given us once -- and so the link is reachable at ANY time, not only in the
// seconds after the form was submitted.
//
// ⚠️ Copy Link and Resend are NOT the same thing and the difference matters:
// Copy Link hands you the CURRENT link to send yourself, Resend mints a NEW
// one and kills the old. Reach for Copy when the email went astray, Resend
// when the link itself needs replacing.
export function PendingList({ people, onCopied, onResend, onCancel, resending }) {
  if (people.length === 0) return null
  return (
    <div style={s.pending}>
      <strong style={{ color: 'rgba(245,239,228,0.7)' }}>Invited (Waiting for First Sign-In):</strong>
      {people.map(i => (
        <div key={i.email} style={s.pendingRow}>
          <span style={s.pendingWho}>{i.full_name || '—'} · {i.email}</span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* ⚠️ A FAILED COPY MUST STILL LEAVE THE LINK ON SCREEN. The panel
                this replaced printed the URL as selectable text, so a clipboard
                write that did not happen was survivable. navigator.clipboard is
                absent outside a secure context and can reject even inside one,
                and the old code called it with `?.` and reported success either
                way -- the silent-failure shape this app keeps relearning. */}
            <button type="button" style={s.copyLinkBtn}
              onClick={async () => {
                const who = i.full_name || i.email
                try {
                  await navigator.clipboard.writeText(i.invite_url)
                  onCopied({ text: `Invite link for ${who} copied.` })
                } catch {
                  onCopied({ text: `Couldn’t copy automatically. Here is the link for ${who}:`, link: i.invite_url, bad: true })
                }
              }}>
              Copy Link
            </button>
            <button type="button" style={s.resendBtn} disabled={resending === i.email}
              onClick={() => onResend(i)}>
              {resending === i.email ? 'Sending…' : 'Resend'}
            </button>
            <button type="button" style={s.cancelBtn} onClick={() => onCancel(i)}>
              Cancel
            </button>
          </span>
        </div>
      ))}
    </div>
  )
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
  // ⚠️ THERE IS NO LONGER A ONE-SHOT RESULT PANEL. Until 2026-09-06 the invite
  // link appeared ONLY in a panel rendered straight after the form, so it was
  // gone the moment you dismissed it, invited someone else, or reloaded -- and
  // the link a manager most wants to send is the one for a patient who has not
  // signed in yet, which is precisely the case the panel had stopped showing.
  // The link now lives on the pending row itself, where it stays until they
  // join. (David: "a copy url button link unique to the patient that can always
  // stay there and be copied at any time".)
  // ⚠️ "ARCHIVE" ON SCREEN IS `discharged_at` IN THE DATABASE, and the RPCs are
  // still discharge_patient / restore_patient. Renamed in the UI on 2026-09-06
  // because "Discharge" read as a clinical decision when all it does is clear
  // the roster, and because "Inactive" was already taken by the automatic
  // 5-day flag. The database was deliberately NOT renamed: that means a patch
  // touching RLS policies, functions and tests for a vocabulary change. Same
  // call the invite functions got when they kept their staff_* names.
  // ⚠️ TWO SLOTS, BECAUSE THEY WANT OPPOSITE LIFETIMES. `flash` is a confirmation
  // of something that already happened ("Felix was removed.") and clears itself:
  // the roster below it is the real proof, so leaving it up is just litter, and
  // David watched one sit there until he refreshed the page. `notice` is an ERROR
  // and must NEVER auto-clear -- a failure the user did not happen to be looking
  // at is a failure they never saw, which is the silent-failure shape this app
  // keeps relearning.
  const [flash, setFlash] = useState('')
  const flashTimer = useRef(null)
  const [undo, setUndo] = useState(null)          // { id, name } after archiving
  const [removing, setRemoving] = useState(null)  // { id, name, checkins }
  const [removeText, setRemoveText] = useState('')
  // ⚠️ A NOTICE CARRIES ITS KIND, because this slot now reports failures too:
  // an invite whose email did not send, and the form's own validation. Those
  // used to render in the same success green as "Invite emailed to X", which
  // says the opposite of what happened. { text, bad } or null.
  const [patientNotice, setPatientNotice] = useState(null)
  const [staffNotice, setStaffNotice] = useState(null)
  const [pName, setPName] = useState('')
  const [pEmail, setPEmail] = useState('')

  // Show a self-clearing confirmation. Six seconds: long enough to read a short
  // sentence twice, short enough that it is gone before it becomes furniture.
  const showFlash = useCallback((msg) => {
    setFlash(msg)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 6000)
  }, [])
  // Cancel the pending timers on unmount, or they fire into a gone component.
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const isManager = profile?.role === 'manager'
  const staffName = greetingName(profile?.full_name)

  // Load the roster, splitting active patients from discharged (soft-deleted) ones.
  // The roster endpoint writes the HIPAA view_roster audit row server-side, in the
  // same transaction as the read. Reused after a discharge/restore to refresh.
  const loadRoster = useCallback(async () => {
    const { patients, checkins } = await fetchClinicData()
    const active = patients.filter(p => !p.discharged_at)
    setRoster(buildRoster(active, checkins))
    // The check-in COUNT, not a yes/no: since 2026-09-06 a patient with history
    // can be removed too, so the number is no longer a gate. It is there so the
    // confirmation can tell the manager exactly what they are about to destroy.
    const counts = checkins.reduce((m, c) => m.set(c.user_id, (m.get(c.user_id) || 0) + 1), new Map())
    setDischarged(patients.filter(p => p.discharged_at).map(p => ({
      id: p.id, name: p.full_name || 'Patient', checkins: counts.get(p.id) || 0,
    })))
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

  // Cancelling a pending invite. The commonest reason is a typo'd address, and
  // until this existed that invite stayed live and claimable for 14 days.
  async function handleCancelInvite(inv) {
    if (!window.confirm(`Cancel the invite to ${inv.email}? Their link stops working immediately.`)) return
    try {
      await api.revokeInvite(inv.email)
      setInvites(await fetchPendingInvites())
      const note = { text: `Invite to ${inv.email} cancelled.` }
      if (inv.role === 'patient') setPatientNotice(note); else setStaffNotice(note)
    } catch (err) {
      const note = { text: `Couldn't cancel that invite: ${err.message}`, bad: true }
      if (inv.role === 'patient') setPatientNotice(note); else setStaffNotice(note)
    }
  }

  // ⛔ NO window.confirm HERE, AND THAT IS DELIBERATE. Archiving destroys
  // nothing and is reversible in one click, so a confirmation dialog is friction
  // for its own sake. Undo is the honest pattern for a reversible action, and it
  // is kinder than a modal that has to be dismissed every single time.
  async function handleArchive(patientId, name) {
    setNotice('')
    try {
      await dischargePatient(patientId)
      await loadRoster()
      setUndo({ id: patientId, name })
    } catch (err) {
      setNotice(`Couldn’t archive ${name}: ${err.message}`)
    }
  }

  // ⚠️ ONE CARD, NOT A COLUMN, BECAUSE IT IS THE SAME LINK FOR EVERY PATIENT.
  // It briefly lived on each roster row and David was right that it was
  // extraneous there: a per-row button implies a per-row link, and there is no
  // such thing once a patient has joined -- their invite token is consumed at
  // that moment. Minting them a permanent personal one was considered and
  // REJECTED: resolving it would have to say WHICH ADDRESS it belongs to, and
  // "this email address belongs to a physical therapy patient" is individually
  // identifiable health information, sitting in a text message forever and
  // logged by API Gateway every time it is opened. An invite link accepts that
  // for 14 days because it has no choice; a permanent one has a choice.
  //
  // ⛔ IT COPIES THE INSTRUCTION, NOT A BARE URL, AND THAT IS THE POINT OF IT.
  // David: "I only ever wanted a url to send after they joined, and with maybe
  // the instruction for accessing the check in." Someone who has lost their way
  // back does not only need the address, they need to know what happens when
  // they get there. The exact text is rendered on the card, so what lands in the
  // clipboard is never a surprise, and the URL inside it stays selectable for a
  // manager who wants only that.
  //
  // Derived from the running origin, never hardcoded, the same reason the
  // onboard page derives its own link: no URL to remember to update, and it is
  // correct on localhost too.
  const signInUrl = `${window.location.origin}/login`
  const signInMessage =
    `Check in with GlowPT at ${signInUrl}. Enter your email address and we’ll send you a code to sign in.`

  // ⚠️ THE BUTTON REPORTS ITS OWN RESULT rather than writing to a message slot.
  // There is one control on this card and the text it copies is already on
  // screen, so a failed write leaves the manager able to select it by hand --
  // which is the fallback the pending rows had to be given explicitly.
  const [copyState, setCopyState] = useState('')
  const copyTimer = useRef(null)
  async function copySignInMessage() {
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(signInMessage)
      setCopyState('done')
    } catch {
      setCopyState('failed')
    }
    copyTimer.current = setTimeout(() => setCopyState(''), 4000)
  }

  async function handleRestore(patientId) {
    setNotice('')
    setUndo(null)
    try {
      await restorePatient(patientId)
      await loadRoster()
    } catch (err) {
      setNotice(`Couldn’t restore: ${err.message}`)
    }
  }

  // Permanent: their records AND their sign-in. Gated on the manager typing the
  // patient's name, which is the only deliberateness left now that having
  // check-ins no longer blocks removal. A yes/no dialog is too easy to click
  // through for something with no undo.
  async function handleRemove() {
    if (!removing) return
    const { id, name } = removing
    try {
      await api.purgePatient(id)
      setRemoving(null); setRemoveText(''); setUndo(null)
      await loadRoster()
      showFlash(`${name} was removed.`)
    } catch (err) {
      setNotice(`Couldn’t remove ${name}: ${err.message}`)
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
    setNote(null); setResending(inv.email)
    try {
      const res = patient
        ? await api.invitePatient(inv.email, inv.full_name)
        : await api.inviteStaff(inv.email, inv.full_name, inv.role)
      // The re-read matters more than usual here: a resend mints a FRESH token,
      // so the copy link on the row below is stale until this lands.
      setInvites(await fetchPendingInvites())
      setNote(res.email_sent
        ? { text: `Invite resent to ${inv.email}. Their previous link no longer works.` }
        : { text: `New link created for ${inv.email}, but the email didn’t send. Copy their link below and send it yourself.`, bad: true })
    } catch (err) {
      setNote({ text: `Couldn’t resend to ${inv.email}: ${err.message}`, bad: true })
    } finally {
      setResending('')
    }
  }

  async function handlePatientInvite(e) {
    e.preventDefault()
    setPatientNotice(null)
    const name = pName.trim(), email = pEmail.trim()
    if (!name) return setPatientNotice({ text: 'Enter the patient’s name.', bad: true })
    if (!email) return setPatientNotice({ text: 'Enter the patient’s email.', bad: true })
    let res
    try {
      res = await api.invitePatient(email, name)
    } catch (err) {
      return setPatientNotice({ text: `Couldn’t send invite: ${err.message}`, bad: true })
    }
    setPName(''); setPEmail('')
    // The link is no longer repeated here: it is on their pending row below, and
    // it stays there. Either way the invite itself is already saved, so a failed
    // send never loses it -- it just changes who does the sending.
    setPatientNotice(res.email_sent
      ? { text: `Invite emailed to ${name}. Their link is below until they join.` }
      : { text: `Invite created for ${name}, but the email didn’t send. Copy their link below and send it yourself.`, bad: true })
    // ⚠️ THIS LINE WAS MISSING AND THE INVITE SIMPLY NEVER APPEARED UNDER
    // "Invited (Waiting for First Sign-In)" until the page was reloaded. The row
    // was created correctly every time -- the list just never re-read it, so
    // Resend and Cancel were unreachable for the invite you had only just sent,
    // which is exactly when you want them.
    //
    // ⛔ THE STAFF HANDLER HAS ALWAYS HAD IT. That asymmetry is the recurring
    // bug in this file, not a one-off: the patient invite path keeps being built
    // second and keeps missing a step the staff path already had (2026-09-05 it
    // was the message slot, reporting into the Care Team card). WHEN YOU TOUCH
    // ONE OF THESE TWO HANDLERS, DIFF IT AGAINST THE OTHER.
    setInvites(await fetchPendingInvites())
  }

  async function handleInvite(e) {
    e.preventDefault()
    setStaffNotice(null)
    const name = tName.trim(), email = tEmail.trim()
    if (!name) return setStaffNotice({ text: 'Enter the therapist’s name.', bad: true })
    if (!email) return setStaffNotice({ text: 'Enter the therapist’s email.', bad: true })
    let res
    try {
      res = await inviteTherapist(email, name)
    } catch (err) {
      return setStaffNotice({ text: `Couldn’t send invite: ${err.message}`, bad: true })
    }
    setTName(''); setTEmail('')
    // Same shape as the patient handler. ⛔ DIFF THESE TWO AGAINST EACH OTHER
    // whenever you touch one: the patient path keeps being built second and
    // keeps missing a step this one already had.
    setStaffNotice(res.email_sent
      ? { text: `Invite emailed to ${name}. Their link is below until they join.` }
      : { text: `Invite created for ${name}, but the email didn’t send. Copy their link below and send it yourself.`, bad: true })
    setInvites(await fetchPendingInvites())
  }

  const Bar = (
    <div style={s.bar}>
      <BrandLockup label={clinic?.name} />
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: FLEX_ALIGN[c.align] }}>
            <select style={s.sel} value={r.therapistId || ''} onChange={e => handleAssign(r.id, e.target.value || null)}>
              <option value="">Unassigned</option>
              {therapists.map(t => <option key={t.id} value={t.id}>{t.full_name || 'Therapist'}</option>)}
            </select>
          </div>
        )
      case 'archive':
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: FLEX_ALIGN[c.align] }}>
            <button style={s.dischargeBtn} onClick={() => handleArchive(r.id, r.name)}>Archive</button>
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
                  onChange={e => { setPName(e.target.value); setPatientNotice(null) }} autoComplete="name" />
                <input style={s.inviteInput} placeholder="Patient email" type="email" value={pEmail}
                  onChange={e => { setPEmail(e.target.value); setPatientNotice(null) }}
                  autoComplete="off" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button style={s.inviteBtn} type="submit">Invite Patient →</button>
              </form>
              {patientNotice && (
                <div style={patientNotice.bad ? s.noticeBad : s.notice}>
                  {patientNotice.text}
                  {patientNotice.link && <div style={s.noticeLink}>{patientNotice.link}</div>}
                </div>
              )}
              <PendingList people={pendingPatients} onCopied={setPatientNotice}
                onResend={resendInvite} onCancel={handleCancelInvite} resending={resending} />
            </div>

            {/* ⚠️ ITS OWN CARD, DIRECTLY UNDER THE INVITE FORM, BECAUSE IT DOES
                THE OPPOSITE JOB. Inviting brings someone NEW in; this helps
                someone who is ALREADY in and cannot find their way back. Folding
                it into the invite card would put two different jobs under one
                heading, and folding it into the roster implied a per-patient link
                that does not exist. */}
            <div style={s.care}>
              <div style={s.careHead}>Patient Sign-In Link</div>
              <div style={s.signInLead}>
                For a patient who has already joined and needs to get back to their
                check-in. The same link works for everyone, so there is nothing to
                look up.
              </div>
              <div style={s.signInBox}>{signInMessage}</div>
              <div style={s.signInRow}>
                <button type="button" style={s.inviteBtn} onClick={copySignInMessage}>
                  {copyState === 'done' ? 'Copied ✓' : copyState === 'failed' ? 'Couldn’t Copy' : 'Copy Message'}
                </button>
                <span style={s.signInHint}>
                  {copyState === 'failed'
                    ? 'Select the text above and copy it by hand.'
                    : 'Paste it into a text or an email.'}
                </span>
              </div>
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
                  onChange={e => { setTName(e.target.value); setStaffNotice(null) }} autoComplete="name" />
                <input style={s.inviteInput} placeholder="Therapist email" type="email" value={tEmail}
                  onChange={e => { setTEmail(e.target.value); setStaffNotice(null) }}
                  autoComplete="off" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button style={s.inviteBtn} type="submit">Invite Therapist →</button>
              </form>
              {staffNotice && (
                <div style={staffNotice.bad ? s.noticeBad : s.notice}>
                  {staffNotice.text}
                  {staffNotice.link && <div style={s.noticeLink}>{staffNotice.link}</div>}
                </div>
              )}
              <PendingList people={pendingStaff} onCopied={setStaffNotice}
                onResend={resendInvite} onCancel={handleCancelInvite} resending={resending} />
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
        {flash && <div style={s.notice}>{flash}</div>}
        {undo && (
          <div style={s.notice}>
            Archived {undo.name}.{' '}
            <button type="button" style={s.undoLink} onClick={() => handleRestore(undo.id)}>Undo</button>
          </div>
        )}

        {!loading && roster.length > 0 && (
          <>
            {/* ⚠️ ONE RUN OF FACES, NOT FIVE LABELLED ITEMS, AND FLOWING TEXT
                RATHER THAN A FLEX ROW. Both halves were needed, and MEASURING is
                what showed it: naming all five faces put seven items in a
                wrap-happy flex row, but simply collapsing them to a scale changed
                the height not at all below 393px -- a flex row can only break at
                its 16px gaps, so a 251px scale that will not sit beside anything
                takes a whole row either way. As inline text it breaks between
                words instead, which halves it: 118px -> 62px at 375/390/393,
                78 -> 39 on a desktop. The five faces stay one nowrap group so the
                ramp itself can never split.
                "3-Day Trend" left the label because the roster column header
                immediately below already says it. */}
            <div style={s.legend}>
              <span style={s.legendLabel}>Daily Feeling</span>{' '}
              <span style={s.legendEnd}>{FEELINGS[1].word}</span>{' '}
              <span style={s.legendFaces}>
                {[1, 2, 3, 4, 5].map(n => (
                  <span key={n} style={s.face} title={FEELINGS[n].word}>{FEELINGS[n].emoji}</span>
                ))}
              </span>{' '}
              <span style={s.legendEnd}>{FEELINGS[5].word}</span>{' '}
              <span style={s.legendNone}><span style={s.noCheckin} /> No check-in</span>
            </div>
            <div style={s.scroll}>
              {/* Manager total: 140+64+72+44+82+170+92 = 664 of columns,
                  + 6 gaps of 12 = 72, + 32 padding = 768, + 2 for the ROW's 1px
                  border, which the header does not have = 770.
                  ⚠️ THE +2 IS NOT PADDING-FOR-LUCK, and the old 780 carried slack
                  that hid it: at an exact fit the row's border eats 2px of its
                  content box, and the only track that can give it up is the
                  Patient column's minmax, so the header sits 140 wide over a 138
                  cell. Measured on 2026-09-06, when an eighth column briefly made
                  the fit exact and surfaced it.
                  ⚠️ RECOMPUTE THIS WHENEVER A COLUMN IS ADDED OR REMOVED. Below
                  the real width the grid squeezes the columns instead of
                  scrolling, which quietly undoes their measured ceilings. */}
              <div style={{ minWidth: isManager ? 770 : 560 }}>
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
              {showDischarged ? '▾' : '▸'} Archived ({discharged.length})
            </button>
            {showDischarged && (
              <div style={s.dischargedList}>
                {discharged.map(d => (
                  <div key={d.id}>
                    <div style={s.dischargedRow}>
                      <span>{d.name}</span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button style={s.restoreBtn} onClick={() => handleRestore(d.id)}>Restore</button>
                        {/* Offered for everyone since 2026-09-06, including a
                            patient with check-ins. The deliberateness is the
                            typed name below, not the absence of the button. */}
                        <button
                          style={s.removeBtn}
                          onClick={() => { setRemoving({ id: d.id, name: d.name, checkins: d.checkins }); setRemoveText('') }}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                    {removing?.id === d.id && (
                      <div style={s.removeConfirm}>
                        <div style={s.removeConfirmHead}>Remove {d.name} permanently?</div>
                        <div style={s.removeConfirmBody}>
                          {/* Says the number out loud. "Their records" is easy to
                              click past; "47 check-ins" is not. */}
                          {d.checkins === 0
                            ? 'They have no check-ins. This deletes their consent record and their GlowPT sign-in.'
                            : `This deletes their ${d.checkins} check-in${d.checkins === 1 ? '' : 's'}, their consent record and their GlowPT sign-in.`}
                          {' '}It cannot be undone. Backups hold a copy for 35 days, then it is gone for good.
                        </div>
                        <label style={s.removeConfirmLabel} htmlFor={`rm-${d.id}`}>
                          Type {d.name} to confirm.
                        </label>
                        <input
                          id={`rm-${d.id}`}
                          style={s.removeConfirmInput}
                          value={removeText}
                          onChange={e => setRemoveText(e.target.value)}
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          <button
                            style={{ ...s.removeBtn, opacity: removeText.trim().toLowerCase() === d.name.trim().toLowerCase() ? 1 : 0.4 }}
                            disabled={removeText.trim().toLowerCase() !== d.name.trim().toLowerCase()}
                            onClick={handleRemove}
                          >
                            Remove Permanently
                          </button>
                          <button style={s.restoreBtn} onClick={() => { setRemoving(null); setRemoveText('') }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
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
