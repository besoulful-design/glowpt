// GlowPT · CLEAN RESET of the Riverside demo clinic (DEMO DATA ONLY)
// Wipes all test cruft (stray patients, tangled records), makes David a clean
// manager, and rebuilds the 6 demo patients (incl. showcase Grace Bennett) with fresh check-in histories.
//
// Run:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
//   node scripts/reset-demo.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const CLINIC = { name: 'Riverside PT', slug: 'riverside-pt' }
const MANAGER_EMAIL = 'besoulful@gmail.com'          // David — kept & set as manager, never deleted
// Demo accounts use real Gmail +aliases so the weekly email DELIVERS. Fake
// @glowpt.app addresses hard-bounce (no mailbox) and damage our sending reputation.
const alias = (n) => `dwpeterson15+${n}@gmail.com`
const THERAPIST_EMAIL = alias('samtorres')
const PROTECT = new Set([MANAGER_EMAIL, THERAPIST_EMAIL])

const FEELING_WORDS = { 1: 'Really tough', 2: 'Hard day', 3: 'Getting there', 4: 'Good day', 5: 'Feeling great' }
const NOTES = ['Stiff this morning but loosened up after my walk.', 'Did my exercises even though I didn’t feel like it.', 'Knee felt good today.', 'Rested — needed it.', 'Small win: stairs were easier.']
const MOVES = [['PT exercises'], ['PT exercises', 'Walk or light activity'], ['Stretching'], ['Rest day'], ['Walk or light activity']]
// Showcase patient — ~4 weeks of near-daily, upward-trending check-ins with a 14-day
// streak, so the patient Progress screen (streak + 30-day trend) looks great in demos.
function showcaseCheckins() {
  const recent = [3, 4, 3, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 5]      // last 14 days (ago 13→0), daily → 14-day streak
  const out = recent.map((feeling, idx) => ({ ago: 13 - idx, feeling }))
  const earlier = [
    { ago: 29, feeling: 2 }, { ago: 28, feeling: 3 }, { ago: 26, feeling: 2 }, { ago: 25, feeling: 3 },
    { ago: 23, feeling: 3 }, { ago: 22, feeling: 2 }, { ago: 20, feeling: 4 }, { ago: 19, feeling: 3 },
    { ago: 17, feeling: 3 }, { ago: 16, feeling: 4 }, { ago: 15, feeling: 4 },
  ]
  return [...earlier, ...out]
}
const PATIENTS = [
  ['Grace Bennett', showcaseCheckins(), 'dwpeterson15+grace@gmail.com'], // real alias so David can log in AS her to demo the Progress screen
  ['Chris Alvarez', [0, 1, 2, 3, 4, 6].map((ago, i) => ({ ago, feeling: [4, 3, 4, 5, 3, 4][i] }))],
  ['Maria Chen', [0, 2, 3, 5].map((ago, i) => ({ ago, feeling: [3, 4, 2, 3][i] }))],
  ['James Okafor', [8, 9, 11].map((ago, i) => ({ ago, feeling: [3, 4, 3][i] }))],
  ['Linda Park', [0, 1, 3, 4].map((ago, i) => ({ ago, feeling: [2, 2, 3, 4][i] }))],
  ['Robert Ellis', [1, 5, 9].map((ago, i) => ({ ago, feeling: [4, 3, 5][i] }))],
]

async function allUsers() {
  const users = []
  for (let page = 1; page <= 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 })
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 200) break
  }
  return users
}

async function ensureUser(email, fullName, role, clinicId, therapistId = null) {
  const users = await allUsers()
  let user = users.find(u => u.email === email)
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } })
    if (error) { console.error(`createUser ${email}:`, error.message); return null }
    user = data.user
  }
  const { error } = await db.from('profiles').upsert(
    { id: user.id, clinic_id: clinicId, role, full_name: fullName, therapist_id: therapistId },
    { onConflict: 'id' },
  )
  if (error) console.error(`profile ${email}:`, error.message)
  return user
}

function atDaysAgo(days) { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(9, 0, 0, 0); return d.toISOString() }

async function run() {
  // 1) Clinic (create if missing)
  let { data: clinic } = await db.from('clinics').select('id').eq('slug', CLINIC.slug).maybeSingle()
  if (!clinic) {
    const { data } = await db.from('clinics').insert(CLINIC).select('id').single()
    clinic = data
  }
  console.log('Clinic:', CLINIC.name, clinic.id)

  // 2) Wipe ALL check-ins for this clinic (clean slate, removes orphans too)
  await db.from('checkins').delete().eq('clinic_id', clinic.id)

  // 3) Delete every PATIENT user in this clinic (demo + stray test accounts),
  //    except protected accounts. Cascades their profile.
  const { data: profs } = await db.from('profiles').select('id, role').eq('clinic_id', clinic.id)
  const users = await allUsers()
  const emailById = Object.fromEntries(users.map(u => [u.id, u.email]))
  let removed = 0
  for (const p of (profs ?? [])) {
    const email = emailById[p.id]
    if (email && PROTECT.has(email)) continue
    if (p.role === 'patient') {
      await db.auth.admin.deleteUser(p.id)
      removed++
    }
  }
  console.log(`Removed ${removed} patient/test account(s).`)

  // 4) David = clean manager (fix even if he was tangled as a patient); no check-ins
  const manager = await ensureUser(MANAGER_EMAIL, 'David Peterson', 'manager', clinic.id)
  if (manager) await db.from('checkins').delete().eq('user_id', manager.id)
  // 5) Therapist
  const therapist = await ensureUser(THERAPIST_EMAIL, 'Sam Torres', 'therapist', clinic.id)
  console.log('Manager (you) + therapist set.')

  // 6) Rebuild the 5 demo patients + fresh check-ins
  for (const [name, checkins, customEmail] of PATIENTS) {
    const email = customEmail || alias(name.toLowerCase().split(' ')[0])
    // If a stray user with this email survived, reuse; ensureUser handles it.
    const user = await ensureUser(email, name, 'patient', clinic.id, therapist?.id ?? null)
    if (!user) continue
    await db.from('checkins').delete().eq('user_id', user.id)
    const rows = checkins.map((c, i) => ({
      user_id: user.id, clinic_id: clinic.id, feeling: c.feeling,
      feeling_word: FEELING_WORDS[c.feeling], movements: MOVES[i % MOVES.length],
      note: NOTES[i % NOTES.length], ai_response: 'You showed up today — and that matters.',
      created_at: atDaysAgo(c.ago),
    }))
    const { error } = await db.from('checkins').insert(rows)
    if (error) console.error(`checkins ${name}:`, error.message)
    else console.log(`  ${name}: ${rows.length} check-ins`)
  }

  console.log('\n✅ Clean reset done. You are the Riverside PT manager; roster = 6 demo patients (incl. showcase Grace Bennett).')
}

run()
