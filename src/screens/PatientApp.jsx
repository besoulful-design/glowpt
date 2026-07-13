import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth'

const feelingData = {
  1: { emoji: '😔', word: 'Really tough' },
  2: { emoji: '😕', word: 'Hard day' },
  3: { emoji: '🙂', word: 'Getting there' },
  4: { emoji: '😊', word: 'Good day' },
  5: { emoji: '😄', word: 'Feeling great' },
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] // Mon → Sun

function startOfWeek(d) {
  const date = new Date(d)
  const offset = (date.getDay() + 6) % 7 // days since Monday
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  return date
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Build the current Mon–Sun week from real check-in rows.
function buildWeek(checkins) {
  const monday = startOfWeek(new Date())
  const today = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const match = checkins.find(c => sameLocalDay(new Date(c.created_at), date))
    const f = match?.feeling
    return {
      id: i,
      day: DAY_LETTERS[i],
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      feeling: f ?? null,
      emoji: f ? feelingData[f].emoji : '',
      word: f ? feelingData[f].word : '',
      movements: match?.movements ?? [],
      note: match?.note ?? '',
      response: match?.ai_response ?? '',
      done: !!match,
      today: sameLocalDay(date, today),
    }
  })
}

// Mood colors for the 30-day trend — matches the clinic dashboard (1 red → 5 green,
// with Good/Great kept clearly distinct).
const FEELING_COLOR = { 1: '#c0554d', 2: '#d07d45', 3: '#c8861d', 4: '#b6c24a', 5: '#2fa06d' }

// Shared card surface for the Progress screen sections.
const CARD = { background: '#1a2840', border: '1px solid rgba(200,134,29,0.16)', borderRadius: '12px', padding: '20px' }

// Build the last 30 days (oldest → newest), one slot per day, from check-in rows.
function build30Days(checkins) {
  const base = new Date(); base.setHours(0, 0, 0, 0)
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(base)
    date.setDate(base.getDate() - (29 - i))
    const match = checkins.find(c => sameLocalDay(new Date(c.created_at), date))
    return {
      feeling: match?.feeling ?? null,
      done: !!match,
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  })
}

// Consecutive days checked in, ending today (or yesterday if today isn't done yet).
function streakFromDays(days) {
  let i = days.length - 1
  if (i >= 0 && !days[i].done) i-- // today not done yet is fine — count from yesterday
  let streak = 0
  while (i >= 0 && days[i].done) { streak++; i-- }
  return streak
}

function streakMessage(s) {
  if (s <= 0) return 'Check in today to start your streak.'
  if (s === 1) return 'Great start — one day down.'
  if (s < 4) return 'You’re building momentum.'
  if (s < 7) return 'You’re on a roll!'
  return 'Incredible consistency 🌟'
}

const avgFeeling = arr => { const fs = arr.filter(d => d.feeling != null).map(d => d.feeling); return fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null }

// Gentle, never-clinical read on the last 30 days (recent week vs the week before).
function trendMessage(days) {
  const recent = avgFeeling(days.slice(-7)), prev = avgFeeling(days.slice(-14, -7))
  if (recent == null) return 'Check in to start building your trend.'
  if (prev == null) return 'Keep checking in to see your trend take shape.'
  if (recent >= prev + 0.4) return 'You’re trending up lately 🌤'
  if (recent <= prev - 0.4) return 'Some tougher days recently — gentle steps still count 💛'
  return 'You’re holding steady — consistency matters most 🌱'
}

// One-line takeaway for the month: average mood + how many days.
function monthSummary(days) {
  const fs = days.filter(d => d.feeling != null).map(d => d.feeling)
  if (!fs.length) return null
  const avg = fs.reduce((a, b) => a + b, 0) / fs.length
  const rounded = Math.max(1, Math.min(5, Math.round(avg)))
  return { avg: avg.toFixed(1), rounded, count: fs.length }
}

// Average mood per week for the last 4 weeks (oldest → newest), for the mini bar chart.
function weeklyAverages(days) {
  const buckets = [
    { label: '3 wks ago', slice: days.slice(2, 9) },
    { label: '2 wks ago', slice: days.slice(9, 16) },
    { label: '1 wk ago', slice: days.slice(16, 23) },
    { label: 'This week', slice: days.slice(23, 30) },
  ]
  return buckets.map(b => {
    const avg = avgFeeling(b.slice)
    return { label: b.label, avg, rounded: avg ? Math.max(1, Math.min(5, Math.round(avg))) : null }
  })
}

const LogoMark = ({ size = 220 }) => (
  <svg width={size} height={Math.round(size * 0.58)} viewBox="0 0 130 75" fill="none">
    <defs>
      <radialGradient id="haze" cx="50%" cy="100%" r="70%">
        <stop offset="0%" stopColor="#e0a035" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#e0a035" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="arc3" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#c8861d" stopOpacity="0.15" />
        <stop offset="50%" stopColor="#e0a035" />
        <stop offset="100%" stopColor="#c8861d" stopOpacity="0.15" />
      </linearGradient>
    </defs>
    <ellipse cx="65" cy="72" rx="58" ry="20" fill="url(#haze)" />
    <path d="M 18 72 A 47 47 0 0 1 112 72" fill="none" stroke="#c8861d" strokeWidth="1" strokeOpacity="0.2" strokeLinecap="round" />
    <path d="M 30 72 A 35 35 0 0 1 100 72" fill="none" stroke="#c8861d" strokeWidth="1.8" strokeOpacity="0.45" strokeLinecap="round" />
    <path d="M 44 72 A 21 21 0 0 1 86 72" fill="none" stroke="url(#arc3)" strokeWidth="3" strokeLinecap="round" />
    <circle cx="65" cy="72" r="5" fill="#e0a035" />
    <circle cx="65" cy="72" r="10" fill="#e0a035" opacity="0.15" />
    <circle cx="65" cy="72" r="16" fill="#e0a035" opacity="0.07" />
  </svg>
)

export default function PatientApp() {
  const { user, profile, signOut } = useAuth()
  const firstName = (profile?.full_name || '').trim().split(' ')[0] || 'there'

  const [screen, setScreen] = useState('welcome')
  const [selectedFeeling, setSelectedFeeling] = useState(null)
  const [movements, setMovements] = useState([])
  const [otherMovement, setOtherMovement] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [journalDay, setJournalDay] = useState(null)
  const [greeting, setGreeting] = useState('Good evening')
  const [aiResponse, setAiResponse] = useState('')
  const [week, setWeek] = useState([])
  const [history, setHistory] = useState([])
  const [streak, setStreak] = useState(0)
  const [totalCheckins, setTotalCheckins] = useState(0)
  const [journalReturn, setJournalReturn] = useState('response')

  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 12) setGreeting('Good morning')
    else if (hour < 17) setGreeting('Good afternoon')
    else setGreeting('Good evening')
  }, [])

  // One load powers everything: this week's tappable days, the 30-day trend, the
  // streak, and the all-time check-in count. Pulls the last 30 days in one query.
  const loadData = useCallback(async () => {
    if (!user) return
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 29)
    const { data, error } = await supabase
      .from('checkins')
      .select('feeling, feeling_word, movements, other_movement, note, ai_response, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
    if (error) { console.log('Load error:', error.message); return }
    const rows = data || []
    const days = build30Days(rows)
    setWeek(buildWeek(rows))
    setHistory(days)
    setStreak(streakFromDays(days))
    const { count } = await supabase
      .from('checkins').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
    setTotalCheckins(count || 0)
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const weekCount = week.filter(d => d.done).length
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const toggleMovement = (item) => {
    setMovements(prev => prev.includes(item) ? prev.filter(m => m !== item) : [...prev, item])
  }

  const handleSubmit = async () => {
    setLoading(true)
    let response = "You showed up today — and that's everything."

    try {
      const allMovements = [...movements, ...(otherMovement.trim() ? [otherMovement.trim()] : [])]
      const movementText = allMovements.length > 0 ? allMovements.join(', ') : 'nothing logged'
      const noteText = note.trim() ? note.trim() : 'no note added'
      const feelingWord = selectedFeeling ? feelingData[selectedFeeling].word : 'not rated'
      const isPlanningTo = movements.includes('Planning to do my exercises')

      const prompt = `You are GlowPT, a warm and encouraging wellness companion for physical therapy patients. Write a short, personal response (3-4 sentences max) for ${firstName} based on their daily check-in. Be warm, specific, and uplifting — never clinical. Use their name once.

Their check-in today:
- Feeling score: ${selectedFeeling || 'not rated'} out of 5 (${feelingWord})
- Movement: ${movementText}${isPlanningTo ? ' (note: they are planning to do their exercises later today, not done yet)' : ''}
- Their note: "${noteText}"

Respond directly to ${firstName} in second person. Reference what they actually shared. End with one gentle encouragement.`

      // Calls the Supabase Edge Function (HIPAA-ready). Falls back gracefully on any error.
      const { data, error: fnError } = await supabase.functions.invoke('ai-response', {
        body: { prompt },
      })
      if (!fnError && data?.response) response = data.response
    } catch (err) {
      console.log('AI error:', err)
    }

    const { error } = await supabase.from('checkins').insert({
      user_id: user.id,
      clinic_id: profile?.clinic_id ?? null,
      feeling: selectedFeeling,
      feeling_word: selectedFeeling ? feelingData[selectedFeeling].word : '',
      movements,
      other_movement: otherMovement.trim() || null,
      note,
      ai_response: response,
    })
    if (error) console.log('Save error:', error.message)

    setAiResponse(response)
    await loadData()
    setLoading(false)
    setScreen('response')
  }

  const startNewCheckin = () => {
    setSelectedFeeling(null)
    setMovements([])
    setOtherMovement('')
    setNote('')
    setScreen('checkin')
  }

  const openJournal = (day) => {
    if (!day.done) return
    setJournalReturn(screen) // remember where we came from (response or progress)
    setJournalDay(day)
    setScreen('journal')
  }

  const styles = {
    app: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", WebkitFontSmoothing: 'antialiased' },
    screen: { maxWidth: '430px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0' },
    welcomeWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px 32px 48px', minHeight: '100vh' },
    welcomeTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '0px' },
    logoFloat: { marginBottom: '16px', animation: 'float 4s ease-in-out infinite' },
    wordmark: { display: 'flex', alignItems: 'baseline', marginBottom: '12px' },
    logoGlow: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: '57px', color: '#f5efe4', letterSpacing: '-0.03em', lineHeight: 1 },
    logoPT: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: '57px', color: '#c8861d', letterSpacing: '-0.02em', lineHeight: 1 },
    tagline: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: '21px', color: 'rgba(200,134,29,0.85)', textAlign: 'center', letterSpacing: '0.01em', lineHeight: 1.2 },
    welcomeMiddle: { textAlign: 'center', padding: '0 8px' },
    greeting: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '36px', lineHeight: 1.3, color: '#f5efe4', marginBottom: '36px', letterSpacing: '-0.01em' },
    greetingEm: { color: '#e0a035' },
    welcomeSub: { fontSize: '15px', lineHeight: 1.6, color: 'rgba(245,239,228,0.5)', maxWidth: '30ch', margin: '0 auto' },
    welcomeBottom: { display: 'flex', flexDirection: 'column', gap: '14px' },
    btnPrimary: { width: '100%', padding: '18px 24px', border: 'none', borderRadius: '4px', background: '#c8861d', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em' },
    btnSecondary: { width: '100%', padding: '18px 24px', border: '1px solid rgba(245,239,228,0.15)', borderRadius: '4px', background: 'transparent', color: 'rgba(245,239,228,0.7)', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 500, cursor: 'pointer' },
    btnGhost: { width: '100%', padding: '12px', border: 'none', background: 'transparent', color: 'rgba(245,239,228,0.5)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', cursor: 'pointer' },
    checkinHeader: { padding: '56px 28px 24px' },
    checkinDate: { fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '8px' },
    checkinTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '32px', lineHeight: 1.15, color: '#f5efe4', letterSpacing: '-0.02em' },
    checkinTitleEm: { fontStyle: 'italic', color: '#e0a035' },
    checkinBody: { padding: '8px 28px 40px', display: 'flex', flexDirection: 'column', gap: '28px' },
    qBlock: { display: 'flex', flexDirection: 'column', gap: '14px' },
    qLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(245,239,228,0.7)', letterSpacing: '0.04em', textTransform: 'uppercase' },
    qQuestion: { fontFamily: "'Fraunces', serif", fontWeight: 400, fontSize: '20px', lineHeight: 1.3, color: '#f5efe4', letterSpacing: '-0.01em' },
    feelingScale: { display: 'flex', gap: '10px', justifyContent: 'space-between' },
    feelingBtn: (selected) => ({ flex: 1, border: `1px solid ${selected ? '#c8861d' : 'rgba(245,239,228,0.12)'}`, borderRadius: '6px', background: selected ? '#c8861d' : '#1a2840', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '14px 6px 10px', gap: '6px', transform: selected ? 'scale(1.06)' : 'scale(1)', transition: 'all 0.2s', boxShadow: selected ? '0 4px 18px rgba(200,134,29,0.4)' : 'none' }),
    feelingNum: (selected) => ({ fontFamily: "'Fraunces', serif", fontSize: '36px', fontWeight: selected ? 600 : 400, color: selected ? '#0d1825' : 'rgba(245,239,228,0.7)', lineHeight: 1 }),
    feelingEmoji: { fontSize: '20px', lineHeight: 1 },
    feelingWord: (selected) => ({ fontSize: '10px', color: selected ? 'rgba(13,24,37,0.75)' : 'rgba(245,239,228,0.35)', fontWeight: 500, letterSpacing: '0.04em', textAlign: 'center', lineHeight: 1.2 }),
    movementList: { display: 'flex', flexDirection: 'column', gap: '10px' },
    movementItem: (checked) => ({ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', background: checked ? 'rgba(200,134,29,0.08)' : '#1a2840', border: `1px solid ${checked ? '#c8861d' : 'rgba(245,239,228,0.08)'}`, borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }),
    checkBox: (checked) => ({ width: '22px', height: '22px', border: `1.5px solid ${checked ? '#c8861d' : 'rgba(245,239,228,0.25)'}`, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: checked ? '#c8861d' : 'transparent', transition: 'all 0.2s' }),
    movementLabel: (checked) => ({ fontSize: '15px', color: checked ? '#f5efe4' : 'rgba(245,239,228,0.7)', fontWeight: checked ? 500 : 400 }),
    noteField: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: '15px', lineHeight: 1.6, resize: 'none', outline: 'none', minHeight: '90px' },
    responseWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 28px 48px', minHeight: '100vh' },
    responseTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: '20px' },
    responseMark: { marginBottom: '32px', position: 'relative' },
    responseEyebrow: { fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '20px' },
    responseMessage: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '22px', lineHeight: 1.55, color: '#f5efe4', letterSpacing: '-0.01em', marginBottom: '32px', maxWidth: '34ch' },
    statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', width: '100%', marginBottom: '28px' },
    statCard: { background: '#1a2840', border: '1px solid rgba(200,134,29,0.2)', borderRadius: '4px', padding: '16px', textAlign: 'left' },
    statLabel: { fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '6px' },
    statValue: { fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 400, color: '#f5efe4', letterSpacing: '-0.02em', lineHeight: 1 },
    statSub: { fontSize: '12px', color: 'rgba(245,239,228,0.5)', marginTop: '4px', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
    streakSection: { width: '100%', marginBottom: '8px' },
    streakLabel: { fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,239,228,0.5)', fontWeight: 600, marginBottom: '12px' },
    streakDots: { display: 'flex', gap: '8px', justifyContent: 'center' },
    streakDot: (done, isToday) => ({ width: '38px', height: '38px', borderRadius: '50%', background: isToday ? '#c8861d' : done ? 'rgba(224,160,53,0.15)' : '#1a2840', border: `1px solid ${done || isToday ? '#c8861d' : 'rgba(245,239,228,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: isToday ? '#0d1825' : done ? '#e0a035' : 'rgba(245,239,228,0.5)', fontWeight: isToday ? 700 : 600, cursor: done ? 'pointer' : 'default', boxShadow: isToday ? '0 4px 14px rgba(200,134,29,0.4)' : 'none', transition: 'all 0.2s' }),
    streakHint: { fontSize: '11px', color: 'rgba(245,239,228,0.35)', fontStyle: 'italic', fontFamily: "'Fraunces', serif", textAlign: 'center', marginTop: '10px' },
    // Progress screen
    progressWrap: { display: 'flex', flexDirection: 'column', minHeight: '100vh' },
    progressHeader: { padding: '56px 28px 18px' },
    progressBack: { fontSize: '13px', color: '#c8861d', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', marginBottom: '18px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    progressTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '34px', color: '#f5efe4', letterSpacing: '-0.02em', lineHeight: 1.1 },
    progressSub: { fontSize: '14px', color: 'rgba(245,239,228,0.5)', marginTop: '8px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
    progressBody: { padding: '8px 28px 40px', display: 'flex', flexDirection: 'column', gap: '26px', flex: 1 },
    streakHero: { background: 'linear-gradient(135deg, rgba(200,134,29,0.16), rgba(13,24,37,0))', border: '1px solid rgba(200,134,29,0.28)', borderRadius: '10px', padding: '26px 20px', textAlign: 'center' },
    streakBig: { fontFamily: "'Fraunces', serif", fontWeight: 400, fontSize: '66px', color: '#e0a035', lineHeight: 1, letterSpacing: '-0.03em' },
    streakUnit: { fontSize: '15px', fontWeight: 600, color: '#f5efe4', marginTop: '6px', letterSpacing: '0.02em' },
    streakMsg: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '14px', color: 'rgba(245,239,228,0.6)', marginTop: '10px' },
    trendSection: { ...CARD },
    cardSection: { ...CARD },
    monthSummaryRow: { display: 'flex', alignItems: 'center', gap: '14px', marginTop: '12px', marginBottom: '20px' },
    monthEmoji: { fontSize: '34px', lineHeight: 1 },
    monthAvgVal: { fontFamily: "'Fraunces', serif", fontSize: '26px', color: '#f5efe4', lineHeight: 1.1 },
    monthAvgUnit: { fontSize: '13px', color: 'rgba(245,239,228,0.45)' },
    monthAvgWord: { fontSize: '13px', color: 'rgba(245,239,228,0.55)', fontStyle: 'italic', fontFamily: "'Fraunces', serif", marginTop: '4px' },
    weekBars: { display: 'flex', justifyContent: 'space-between', gap: '12px' },
    weekCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' },
    weekVal: { fontSize: '11px', fontWeight: 600, color: 'rgba(245,239,228,0.7)', height: '14px', marginBottom: '5px' },
    weekBarArea: { width: '100%', height: '84px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
    weekBar: (f, pct) => ({ width: '58%', maxWidth: '30px', height: `${pct}%`, minHeight: '6px', borderRadius: '4px 4px 0 0', background: f ? FEELING_COLOR[f] : 'rgba(245,239,228,0.12)', transition: 'height 0.3s' }),
    weekLabel: { fontSize: '10px', color: 'rgba(245,239,228,0.5)', marginTop: '9px', textAlign: 'center', lineHeight: 1.2 },
    responseBottom: { width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' },
    journalHeader: { padding: '56px 28px 28px', borderBottom: '1px solid rgba(245,239,228,0.07)' },
    journalBack: { fontSize: '13px', color: '#c8861d', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', marginBottom: '20px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    journalDayName: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '36px', lineHeight: 1.1, color: '#e0a035', letterSpacing: '-0.02em', fontStyle: 'italic' },
    journalDateSub: { fontSize: '13px', color: 'rgba(245,239,228,0.5)', marginTop: '6px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
    journalBody: { padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '60px' },
    journalSection: { display: 'flex', flexDirection: 'column', gap: '10px' },
    journalSectionLabel: { fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600 },
    journalFeelingDisplay: { display: 'flex', alignItems: 'center', gap: '16px', background: '#1a2840', border: '1px solid rgba(200,134,29,0.2)', borderRadius: '4px', padding: '18px' },
    journalFeelingEmoji: { fontSize: '36px', lineHeight: 1 },
    journalFeelingNum: { fontFamily: "'Fraunces', serif", fontSize: '36px', fontWeight: 400, color: '#e0a035', letterSpacing: '-0.03em', lineHeight: 1 },
    journalFeelingDesc: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '15px', color: 'rgba(245,239,228,0.7)', lineHeight: 1.4 },
    journalMovementTag: { display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(200,134,29,0.08)', border: '1px solid rgba(200,134,29,0.25)', borderRadius: '4px' },
    journalMovementLabel: { fontSize: '14px', color: 'rgba(245,239,228,0.7)', fontWeight: 500 },
    journalNote: { background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '18px', fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '16px', lineHeight: 1.65, color: 'rgba(245,239,228,0.7)' },
    journalAI: { background: 'linear-gradient(135deg, rgba(200,134,29,0.08) 0%, rgba(13,24,37,0) 100%)', border: '1px solid rgba(200,134,29,0.2)', borderRadius: '4px', padding: '22px', position: 'relative', overflow: 'hidden' },
    journalAILabel: { fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '14px' },
    journalAIText: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '19px', lineHeight: 1.55, color: '#f5efe4', letterSpacing: '-0.01em' },
    loadingWrap: { position: 'fixed', inset: 0, background: '#0d1825', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', zIndex: 100 },
    loadingText: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '18px', color: 'rgba(245,239,228,0.5)', animation: 'breathe 2s ease-in-out infinite' },
    loadingDots: { display: 'flex', gap: '8px' },
    loadingDot: (i) => ({ width: '8px', height: '8px', borderRadius: '50%', background: '#c8861d', animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite` }),
    signOut: { position: 'absolute', top: 18, right: 20, fontSize: 12, color: 'rgba(245,239,228,0.4)', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' },
  }

  const fontStyle = `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,0,400;9..144,1,300;9..144,1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
    @keyframes breathe { 0%,100%{opacity:0.5} 50%{opacity:1} }
    @keyframes dotPulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }
    @keyframes pulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.15);opacity:0.4} }
    * { box-sizing: border-box; } body { margin: 0; background: #0d1825; }
    textarea::placeholder { color: rgba(245,239,228,0.35); font-style: italic; font-family: 'Fraunces', serif; }
    input::placeholder { color: rgba(245,239,228,0.35); font-style: italic; font-family: 'DM Sans', sans-serif; }
    textarea:focus { border-color: rgba(200,134,29,0.4) !important; outline: none; }
    input:focus { border-color: rgba(200,134,29,0.4) !important; }
    button:active { opacity: 0.85; }`

  if (loading) return (
    <div style={styles.app}>
      <style>{fontStyle}</style>
      <div style={styles.loadingWrap}>
        <LogoMark size={160} />
        <div style={styles.loadingText}>Reflecting on your day…</div>
        <div style={styles.loadingDots}>{[0, 1, 2].map(i => <div key={i} style={styles.loadingDot(i)} />)}</div>
      </div>
    </div>
  )

  return (
    <div style={styles.app}>
      <style>{fontStyle}</style>
      <div style={styles.screen}>

        {screen === 'welcome' && (
          <div style={styles.welcomeWrap}>
            <button style={styles.signOut} onClick={signOut}>Sign out</button>
            <div style={styles.welcomeTop}>
              <div style={styles.logoFloat}><LogoMark size={330} /></div>
              <div style={styles.wordmark}>
                <span style={styles.logoGlow}>Glow</span>
                <span style={styles.logoPT}>PT</span>
              </div>
              <div style={styles.tagline}>One good day at a time.</div>
            </div>
            <div style={styles.welcomeMiddle}>
              <div style={styles.greeting}>{greeting}, <span style={styles.greetingEm}>{firstName}.</span></div>
              <div style={styles.welcomeSub}>Your daily check-in is waiting. It only takes a moment.</div>
            </div>
            <div style={styles.welcomeBottom}>
              <button style={styles.btnPrimary} onClick={startNewCheckin}>Start today's check-in →</button>
              {totalCheckins > 0 && (
                <button style={styles.btnSecondary} onClick={() => setScreen('progress')}>View my progress</button>
              )}
            </div>
          </div>
        )}

        {screen === 'checkin' && (
          <div>
            <div style={styles.checkinHeader}>
              <div style={styles.checkinDate}>{dateStr}</div>
              <div style={styles.checkinTitle}>How are you<br /><span style={styles.checkinTitleEm}>feeling today?</span></div>
            </div>
            <div style={styles.checkinBody}>
              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Body check</div>
                <div style={styles.qQuestion}>How does your body feel right now?</div>
                <div style={styles.feelingScale}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const sel = selectedFeeling === n
                    return (
                      <div key={n} style={styles.feelingBtn(sel)} onClick={() => setSelectedFeeling(n)}>
                        <div style={styles.feelingEmoji}>{feelingData[n].emoji}</div>
                        <div style={styles.feelingNum(sel)}>{n}</div>
                        <div style={styles.feelingWord(sel)}>{feelingData[n].word}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Movement</div>
                <div style={styles.qQuestion}>What did you do today?</div>
                <div style={styles.movementList}>
                  {['PT exercises', 'Walk or light activity', 'Stretching', 'Rest day', 'Planning to do my exercises'].map(item => {
                    const checked = movements.includes(item)
                    return (
                      <div key={item} style={styles.movementItem(checked)} onClick={() => toggleMovement(item)}>
                        <div style={styles.checkBox(checked)}>
                          {checked && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#0d1825" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </div>
                        <span style={styles.movementLabel(checked)}>{item}</span>
                      </div>
                    )
                  })}
                  {(() => {
                    const checked = movements.includes('Other')
                    return (
                      <div style={{ ...styles.movementItem(checked), flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}
                        onClick={() => { if (!checked) toggleMovement('Other') }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                          <div style={styles.checkBox(checked)} onClick={(e) => { e.stopPropagation(); toggleMovement('Other') }}>
                            {checked && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#0d1825" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                          </div>
                          <span style={styles.movementLabel(checked)}>Other</span>
                        </div>
                        <input type="text" placeholder="Pilates, meditation, swimming…" value={otherMovement}
                          onChange={e => {
                            setOtherMovement(e.target.value)
                            if (e.target.value.trim() && !movements.includes('Other')) setMovements(prev => [...prev, 'Other'])
                          }}
                          onClick={e => e.stopPropagation()}
                          style={{ background: 'rgba(245,239,228,0.06)', border: '1px solid rgba(200,134,29,0.3)', borderRadius: '4px', padding: '10px 14px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                      </div>
                    )
                  })()}
                </div>
              </div>

              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Anything else?</div>
                <div style={styles.qQuestion}>A moment, a win, a thought.</div>
                <textarea style={styles.noteField} placeholder="Felt a little stiff this morning but loosened up after my walk…" rows={3} value={note} onChange={e => setNote(e.target.value)} />
              </div>

              <button style={{ ...styles.btnPrimary, marginTop: '8px' }} onClick={handleSubmit}>Save today's check-in →</button>
              <div style={{ height: '20px' }} />
            </div>
          </div>
        )}

        {screen === 'progress' && (
          <div style={styles.progressWrap}>
            <div style={styles.progressHeader}>
              <div style={styles.progressBack} onClick={() => setScreen('welcome')}>← Back</div>
              <div style={styles.progressTitle}>Your progress</div>
              <div style={styles.progressSub}>Every check-in is a step forward, {firstName}.</div>
            </div>
            <div style={styles.progressBody}>
              <div style={styles.streakHero}>
                <div style={styles.streakBig}>{streak}</div>
                <div style={styles.streakUnit}>day streak{streak > 0 ? ' 🔥' : ''}</div>
                <div style={styles.streakMsg}>{streakMessage(streak)}</div>
              </div>

              <div style={styles.statsRow}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>This week</div>
                  <div style={styles.statValue}>{weekCount}</div>
                  <div style={styles.statSub}>days checked in</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>All time</div>
                  <div style={styles.statValue}>{totalCheckins}</div>
                  <div style={styles.statSub}>check-ins</div>
                </div>
              </div>

              <div style={styles.trendSection}>
                <div style={styles.streakLabel}>Your month</div>
                {(() => {
                  const sum = monthSummary(history)
                  const weeks = weeklyAverages(history)
                  if (!sum) return <div style={styles.monthAvgWord}>Check in over the next few days to see your monthly summary.</div>
                  return (
                    <>
                      <div style={styles.monthSummaryRow}>
                        <span style={styles.monthEmoji}>{feelingData[sum.rounded].emoji}</span>
                        <div>
                          <div style={styles.monthAvgVal}>{sum.avg} <span style={styles.monthAvgUnit}>avg mood</span></div>
                          <div style={styles.monthAvgWord}>Mostly {feelingData[sum.rounded].word.toLowerCase()} · {sum.count} check-ins in 30 days</div>
                        </div>
                      </div>
                      <div style={styles.weekBars}>
                        {weeks.map((w, i) => (
                          <div key={i} style={styles.weekCol}>
                            <div style={styles.weekVal}>{w.avg ? w.avg.toFixed(1) : ''}</div>
                            <div style={styles.weekBarArea}>
                              <div style={styles.weekBar(w.rounded, w.avg ? (w.avg / 5) * 100 : 0)} />
                            </div>
                            <div style={styles.weekLabel}>{w.label}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}
                <div style={styles.streakHint}>{trendMessage(history)}</div>
              </div>

              <div style={{ ...styles.cardSection, padding: '20px 16px' }}>
                <div style={{ ...styles.streakLabel, paddingLeft: '4px' }}>This week — tap a day</div>
                <div style={{ ...styles.streakDots, justifyContent: 'space-between', gap: '4px' }}>
                  {week.map(d => (
                    <div key={d.id} style={styles.streakDot(d.done, d.today)} onClick={() => openJournal(d)}>{d.day}</div>
                  ))}
                </div>
                <div style={styles.streakHint}>Tap a completed day to read your entry</div>
              </div>
            </div>

            <div style={{ ...styles.responseBottom, padding: '0 28px 40px' }}>
              {week.find(d => d.today)?.done
                ? <button style={styles.btnPrimary} onClick={() => setScreen('welcome')}>Done ✓</button>
                : <button style={styles.btnPrimary} onClick={startNewCheckin}>Start today's check-in →</button>}
            </div>
          </div>
        )}

        {screen === 'response' && (
          <div style={styles.responseWrap}>
            <div style={styles.responseTop}>
              <div style={styles.responseMark}>
                <div style={{ position: 'absolute', inset: '-12px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(224,160,53,0.2) 0%,transparent 70%)', animation: 'pulse 2.5s ease-in-out infinite' }} />
                <LogoMark size={180} />
              </div>
              {aiResponse && <div style={styles.responseEyebrow}>Today's reflection</div>}
              {aiResponse && <div style={styles.responseMessage}>{aiResponse}</div>}

              <div style={styles.statsRow}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>Today's feeling</div>
                  <div style={{ fontSize: '22px', marginBottom: '4px' }}>{selectedFeeling ? feelingData[selectedFeeling].emoji : '—'}</div>
                  <div style={styles.statValue}>{selectedFeeling || '—'}</div>
                  <div style={styles.statSub}>{selectedFeeling ? feelingData[selectedFeeling].word : 'out of 5'}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>This week</div>
                  <div style={styles.statValue}>{weekCount}</div>
                  <div style={styles.statSub}>days checked in</div>
                </div>
              </div>

              <div style={styles.streakSection}>
                <div style={styles.streakLabel}>Your week — tap any day</div>
                <div style={styles.streakDots}>
                  {week.map(d => (
                    <div key={d.id} style={styles.streakDot(d.done, d.today)} onClick={() => openJournal(d)}>{d.day}</div>
                  ))}
                </div>
                <div style={styles.streakHint}>Tap a completed day to read your entry</div>
              </div>
            </div>

            <div style={styles.responseBottom}>
              <button style={styles.btnPrimary} onClick={() => setScreen('welcome')}>Done for today ✓</button>
            </div>
          </div>
        )}

        {screen === 'journal' && journalDay && (
          <div>
            <div style={styles.journalHeader}>
              <div style={styles.journalBack} onClick={() => setScreen(journalReturn)}>← Back</div>
              <div style={styles.journalDayName}>{journalDay.date}</div>
              <div style={styles.journalDateSub}>{journalDay.word}</div>
            </div>
            <div style={styles.journalBody}>
              <div style={styles.journalSection}>
                <div style={styles.journalSectionLabel}>Body feeling</div>
                <div style={styles.journalFeelingDisplay}>
                  <div style={styles.journalFeelingEmoji}>{journalDay.emoji}</div>
                  <div>
                    <div style={styles.journalFeelingNum}>{journalDay.feeling}</div>
                    <div style={styles.journalFeelingDesc}>{journalDay.word}</div>
                  </div>
                </div>
              </div>

              {journalDay.movements.length > 0 && (
                <div style={styles.journalSection}>
                  <div style={styles.journalSectionLabel}>Movement</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {journalDay.movements.map(m => (
                      <div key={m} style={styles.journalMovementTag}>
                        <svg width="14" height="11" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#c8861d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span style={styles.journalMovementLabel}>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {journalDay.note && (
                <div style={styles.journalSection}>
                  <div style={styles.journalSectionLabel}>Your note</div>
                  <div style={styles.journalNote}>{journalDay.note}</div>
                </div>
              )}

              {journalDay.response && (
                <div style={styles.journalSection}>
                  <div style={styles.journalSectionLabel}>Today's reflection</div>
                  <div style={styles.journalAI}>
                    <div style={styles.journalAILabel}>GlowPT</div>
                    <div style={styles.journalAIText}>{journalDay.response}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
