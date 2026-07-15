import { supabase } from '../supabase'

// Fetch a clinic's patients and their check-ins.
// RLS scopes the rows automatically: a manager gets the whole clinic; a therapist
// gets ONLY their assigned patients — so the same call is correct for both roles.
export async function fetchClinicData(clinicId) {
  const [patientsRes, checkinsRes] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, created_at, therapist_id')
      .eq('clinic_id', clinicId).eq('role', 'patient'),
    supabase.from('checkins')
      .select('user_id, feeling, feeling_word, note, created_at')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false }),
  ])
  return { patients: patientsRes.data || [], checkins: checkinsRes.data || [] }
}

// The clinic's therapists (for the manager's assign dropdown + care-team list).
export async function fetchTherapists(clinicId) {
  const { data } = await supabase.from('profiles')
    .select('id, full_name')
    .eq('clinic_id', clinicId).eq('role', 'therapist')
    .order('full_name')
  return data || []
}

// Therapists a manager has invited who haven't signed in yet.
export async function fetchPendingInvites(clinicId) {
  const { data } = await supabase.from('staff_invites')
    .select('email, full_name, role')
    .eq('clinic_id', clinicId).is('consumed_at', null)
    .order('created_at', { ascending: false })
  return data || []
}

// Manager actions (backed by SECURITY DEFINER RPCs that enforce manager + same-clinic).
export function inviteTherapist(email, fullName) {
  return supabase.rpc('invite_staff', { p_email: email, p_full_name: fullName, p_role: 'therapist' })
}
export function assignTherapist(patientId, therapistId) {
  return supabase.rpc('assign_therapist', { p_patient: patientId, p_therapist: therapistId })
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function dayKey(d) { const x = startOfDay(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }
function daysBetween(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000) }

// Consecutive days with a check-in, ending today or yesterday.
function computeStreak(checkins) {
  if (!checkins.length) return 0
  const keys = new Set(checkins.map(c => dayKey(c.created_at)))
  let streak = 0
  const cursor = new Date()
  // allow the streak to still count if they haven't checked in yet *today*
  if (!keys.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (keys.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }
  return streak
}

// Per-patient roster row with trend + clinical flags.
export function buildRoster(patients, checkins) {
  const byUser = {}
  for (const c of checkins) (byUser[c.user_id] ||= []).push(c) // already sorted desc

  return patients.map(p => {
    const cs = byUser[p.id] || []
    const last = cs[0]
    const daysSince = last ? daysBetween(new Date(), last.created_at) : null
    const last3 = cs.slice(0, 3).map(c => c.feeling).reverse() // oldest→newest of the recent 3
    const rated = cs.map(c => c.feeling).filter(f => typeof f === 'number')
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null

    const flags = []
    if (daysSince == null || daysSince >= 5) flags.push('inactive')
    if (cs.length >= 2 && cs[0].feeling <= 2 && cs[1].feeling <= 2) flags.push('low')

    return {
      id: p.id,
      name: p.full_name || 'New patient',
      therapistId: p.therapist_id || null,
      count: cs.length,
      lastCheckin: last?.created_at || null,
      daysSince,
      streak: computeStreak(cs),
      last3,
      avg,
      flags,
    }
  }).sort((a, b) => {
    // most-concerning first: flagged, then least recently active
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length
    return (b.daysSince ?? 999) - (a.daysSince ?? 999)
  })
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

export function relativeDay(dateStr) {
  if (!dateStr) return 'Never'
  const d = daysBetween(new Date(), dateStr)
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}
