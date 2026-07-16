// GlowPT · Demo seed (DEMO DATA ONLY — no real patients)
// Creates a demo clinic, a manager, a therapist, and 6 patients (incl. a showcase
// patient with a rich 30-day history) so the dashboards + patient Progress screen look alive.
//
// Run:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/seed-demo.mjs
//
// The service role key is in your Supabase dashboard → Project Settings → API.
// It bypasses security rules, so only ever use it locally, never in the app.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const CLINIC = { name: 'Riverside PT', slug: 'riverside-pt' }
// Demo accounts use David's real Gmail +aliases (all land in his inbox) so the weekly
// email actually DELIVERS. Fake @glowpt.app addresses hard-bounce — glowpt.app has no
// mailbox — and bounces wreck the sending reputation of our own verified domain.
const alias = (n) => `dwpeterson15+${n}@gmail.com`
const FEELING_WORDS = { 1: 'Really tough', 2: 'Hard day', 3: 'Getting there', 4: 'Good day', 5: 'Feeling great' }
const NOTES = ['Stiff this morning but loosened up after my walk.', 'Did my exercises even though I didn’t feel like it.', 'Knee felt good today.', 'Rested — needed it.', 'Small win: stairs were easier.']
const MOVES = [['PT exercises'], ['PT exercises', 'Walk or light activity'], ['Stretching'], ['Rest day'], ['Walk or light activity']]

// A showcase patient: ~4 weeks of near-daily check-ins, trending upward, with a strong
// current streak — makes the patient "Progress" screen (streak + 30-day trend) shine in demos.
function showcaseCheckins() {
  const recent = [3, 4, 3, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 5]      // last 14 days (ago 13→0), daily → 14-day streak
  const out = recent.map((feeling, idx) => ({ ago: 13 - idx, feeling }))
  const earlier = [                                              // weeks 3–4: a few gaps, lower/mixed moods
    { ago: 29, feeling: 2 }, { ago: 28, feeling: 3 }, { ago: 26, feeling: 2 }, { ago: 25, feeling: 3 },
    { ago: 23, feeling: 3 }, { ago: 22, feeling: 2 }, { ago: 20, feeling: 4 }, { ago: 19, feeling: 3 },
    { ago: 17, feeling: 3 }, { ago: 16, feeling: 4 }, { ago: 15, feeling: 4 },
  ]
  return [...earlier, ...out]
}

// [name, pattern] — pattern is an array of {ago, feeling} check-ins (days ago)
const PATIENTS = [
  ['Grace Bennett', showcaseCheckins(), 'dwpeterson15+grace@gmail.com'],                                      // showcase: 4 wks trending up, 14-day streak. Real alias so David can log in AS her to demo the Progress screen.
  ['Chris Alvarez', [0, 1, 2, 3, 4, 6].map((ago, i) => ({ ago, feeling: [4, 3, 4, 5, 3, 4][i] }))],       // engaged, on track
  ['Maria Chen', [0, 2, 3, 5].map((ago, i) => ({ ago, feeling: [3, 4, 2, 3][i] }))],                        // engaged, mixed
  ['James Okafor', [8, 9, 11].map((ago, i) => ({ ago, feeling: [3, 4, 3][i] }))],                           // inactive (8+ days) → flag
  ['Linda Park', [0, 1, 3, 4].map((ago, i) => ({ ago, feeling: [2, 2, 3, 4][i] }))],                        // two recent low → flag
  ['Robert Ellis', [1, 5, 9].map((ago, i) => ({ ago, feeling: [4, 3, 5][i] }))],                            // sporadic
]

async function findUserByEmail(email) {
  const { data } = await db.auth.admin.listUsers()
  return data?.users?.find(u => u.email === email) || null
}

async function ensureUser(email, fullName, role, clinicId, therapistId = null) {
  let user = await findUserByEmail(email)
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

function atDaysAgo(days) {
  const d = new Date(); d.setDate(d.getDate() - days); d.setHours(9, 0, 0, 0); return d.toISOString()
}

async function run() {
  // 1) Clinic (idempotent by slug)
  let { data: clinic } = await db.from('clinics').select('id').eq('slug', CLINIC.slug).maybeSingle()
  if (!clinic) {
    const { data, error } = await db.from('clinics').insert(CLINIC).select('id').single()
    if (error) { console.error('clinic:', error.message); process.exit(1) }
    clinic = data
  }
  console.log('Clinic:', CLINIC.name, clinic.id)

  // 2) Staff
  const manager = await ensureUser(alias('dana'), 'Dana Reeves', 'manager', clinic.id)
  const therapist = await ensureUser(alias('samtorres'), 'Sam Torres', 'therapist', clinic.id)
  console.log('Manager + therapist ready.')

  // 3) Patients + check-ins
  for (const [name, checkins, customEmail] of PATIENTS) {
    const email = customEmail || alias(name.toLowerCase().split(' ')[0])
    const user = await ensureUser(email, name, 'patient', clinic.id, therapist?.id ?? null)
    if (!user) continue
    // wipe this demo patient's existing check-ins so re-running stays clean
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

  console.log('\nDone. Manager login: ' + alias('dana') + '  ·  Patient link: /join/' + CLINIC.slug)
}

run()
