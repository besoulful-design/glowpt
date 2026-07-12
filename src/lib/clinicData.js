import { supabase } from '../supabase'

// Fetch a clinic's patients and their check-ins (RLS ensures we only get this clinic's rows).
export async function fetchClinicData(clinicId) {
  const [patientsRes, checkinsRes] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, created_at')
      .eq('clinic_id', clinicId).eq('role', 'patient'),
    supabase.from('checkins')
      .select('user_id, feeling, feeling_word, note, created_at')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false }),
  ])
  return { patients: patientsRes.data || [], checkins: checkinsRes.data || [] }
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
    const last7 = cs.slice(0, 7).map(c => c.feeling).reverse() // oldest→newest of the recent 7
    const rated = cs.map(c => c.feeling).filter(f => typeof f === 'number')
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null

    const flags = []
    if (daysSince == null || daysSince >= 5) flags.push('inactive')
    if (cs.length >= 2 && cs[0].feeling <= 2 && cs[1].feeling <= 2) flags.push('low')

    return {
      id: p.id,
      name: p.full_name || 'New patient',
      count: cs.length,
      lastCheckin: last?.created_at || null,
      daysSince,
      streak: computeStreak(cs),
      last7,
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
