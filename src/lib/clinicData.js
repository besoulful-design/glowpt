import * as api from './api'
import { isFeeling } from './feelings'
import { localDateString, daysSinceLocalDate } from './localDay'

// Fetch a clinic's patients and their check-ins.
// RLS scopes the rows automatically: a manager gets the whole clinic; a therapist
// gets ONLY their assigned patients — so the same call is correct for both roles.
// The roster endpoint also writes the HIPAA view_roster audit row server-side, in
// the same transaction as the read (so no separate access_log write is needed).
export async function fetchClinicData() {
  const { patients = [], checkins = [] } = await api.getRoster()
  return { patients, checkins }
}

// The clinic's therapists (for the manager's assign dropdown + care-team list).
export async function fetchTherapists() {
  const { therapists = [] } = await api.getTherapists()
  return therapists
}

// Therapists a manager has invited who haven't signed in yet.
export async function fetchPendingInvites() {
  const { invites = [] } = await api.getInvites()
  return invites
}

// Manager actions (backed by SECURITY DEFINER RPCs that enforce manager + same-clinic).
export function inviteTherapist(email, fullName) {
  return api.inviteStaff(email, fullName, 'therapist')
}
export function assignTherapist(patientId, therapistId) {
  return api.assignTherapist(patientId, therapistId)
}
// Soft-delete: hide a patient from the roster (data kept, reversible via restorePatient).
export function dischargePatient(patientId) {
  return api.dischargePatient(patientId)
}
export function restorePatient(patientId) {
  return api.restorePatient(patientId)
}

// ⚠️ DAYS COME FROM checkins.local_date, NOT FROM created_at. The row stores the
// calendar day the PATIENT was living in when they saved it. Deriving it from
// the timestamp instead was wrong twice over: it filed a post-8pm check-in
// under the next UTC day (so the next morning's overwrote it, 2026-09-12), and
// on this screen it bucketed by whatever day the STAFF member's browser was in,
// so a therapist in another time zone saw their patient's days shifted.
// Do not reintroduce a timestamp-derived day here.

// Consecutive days with a check-in, ending today or yesterday.
function computeStreak(checkins) {
  if (!checkins.length) return 0
  const days = new Set(checkins.map(c => c.local_date).filter(Boolean))
  let streak = 0
  const cursor = new Date()
  // allow the streak to still count if they haven't checked in yet *today*
  if (!days.has(localDateString(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (days.has(localDateString(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }
  return streak
}

// Per-patient roster row with trend + clinical flags.
export function buildRoster(patients, checkins) {
  const byUser = {}
  for (const c of checkins) (byUser[c.user_id] ||= []).push(c) // already sorted desc

  return patients.map(p => {
    const cs = byUser[p.id] || []
    const last = cs[0]
    // Days since the patient's own last check-in DAY, not since the timestamp.
    const daysSince = last ? daysSinceLocalDate(last.local_date) : null
    // ⚠️ EVERY read of `feeling` goes through isFeeling, and that is load-bearing.
    // A stored value off the 1-5 scale (a 0 got in on 2026-09-05) is NOT a rating:
    // it must read as "no check-in", never as a low score. Testing `!= null` or
    // `typeof === 'number'` lets a 0 through, which is what blanked the dashboard.
    // ⚠️ NEWEST FIRST (David, 2026-09-06). `cs` is already sorted desc, so this
    // is simply not reversed any more. It used to render oldest→newest like a
    // sparkline, which is the convention for a "trend" -- but the column is
    // called "Last 3 Check-Ins" now, and the first thing a manager wants is the
    // most recent day, not the oldest one.
    // ⛔ THE PADDING IN `Trend` MUST MATCH: it pushes the empty slots to the END
    // now, because the check-ins a patient does not have yet are the OLD ones.
    const last3 = cs.slice(0, 3).map(c => (isFeeling(c.feeling) ? c.feeling : null)) // newest→oldest
    const rated = cs.map(c => c.feeling).filter(f => isFeeling(f))
    // Guaranteed null or a real 1-5 here, which is what lets the dashboard index
    // FEELINGS by Math.round(avg) without a lookup ever coming back undefined.
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null

    const flags = []
    if (daysSince == null || daysSince >= 5) flags.push('inactive')
    // Still the two most recent check-ins, but an unrated one can no longer pose
    // as a low score and flag a patient who never said they were struggling.
    if (cs.length >= 2 && isFeeling(cs[0].feeling) && isFeeling(cs[1].feeling)
        && cs[0].feeling <= 2 && cs[1].feeling <= 2) flags.push('low')

    return {
      id: p.id,
      name: p.full_name || 'New patient',
      therapistId: p.therapist_id || null,
      count: cs.length,
      // The patient's own last check-in DAY ('YYYY-MM-DD'), so the Last Check-In
      // column reads "Yesterday" against THEIR calendar, not the viewer's.
      lastCheckin: last?.local_date || null,
      daysSince,
      streak: computeStreak(cs),
      last3,
      avg,
      flags,
    }
  }).sort(byFirstName)
}

// ALPHABETICAL BY FIRST NAME (David, 2026-09-06). Until then the roster was
// "most concerning first": flagged patients on top, then whoever had gone
// longest without a check-in. That was deliberate triage from 2026-07-13, but
// the Low Mood / Inactive pills now sit under every flagged name, so trouble
// is visible wherever the row lands, and a manager looking for a specific
// person finds them faster in a list that has a predictable order. The whole
// name breaks ties so "Sam Torres" and "Sam Park" stay stable. Case- and
// accent-insensitive, so "álvarez" sorts with "Alvarez".
function byFirstName(a, b) {
  const fa = (a.name || '').trim().split(/\s+/)[0]
  const fb = (b.name || '').trim().split(/\s+/)[0]
  return fa.localeCompare(fb, 'en', { sensitivity: 'base' }) || (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' })
}

export function clinicStats(roster) {
  const total = roster.length
  const active = roster.filter(r => r.daysSince != null && r.daysSince <= 7).length
  const engagement = total ? Math.round((active / total) * 100) : 0
  const atRisk = roster.filter(r => r.flags.length > 0).length
  const avgs = roster.map(r => r.avg).filter(x => x != null)
  const avgFeeling = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null
  return { total, active, engagement, atRisk, avgFeeling }
}

// Takes a stored local_date ('YYYY-MM-DD'), not a timestamp.
export function relativeDay(dateStr) {
  if (!dateStr) return 'Never'
  const d = daysSinceLocalDate(dateStr)
  if (d == null) return 'Never'
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}
