import { useState, useEffect, useCallback } from 'react'
import * as api from '../lib/api'
import { useAuth } from '../auth'
import { FEELINGS as feelingData } from '../lib/feelings'
import { stripClauseDashes } from '../lib/houseVoice'
import { LogoMark, BRAND, LABEL_SIZE, SECTION_LABEL_SIZE, CARD_LABEL_SIZE } from './AuthShell'

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
      response: stripClauseDashes(match?.ai_response ?? ''),
      done: !!match,
      today: sameLocalDay(date, today),
    }
  })
}

// Mood colors for the 30-day trend — matches the clinic dashboard (1 red → 5 green,
// with Good/Great kept clearly distinct).
// NOTE: level 3's #c8861d is the ONLY surviving use of the old brand amber, and it
// stays on purpose. Here the color is data, not branding — it is the middle step of
// a red→green sequence, spaced against #d07d45 below it and #b6c24a above it.
// Warming it to the new brand amber would make 3 jump brighter than its neighbours
// and read as a warning rather than a neutral middle. Do not "finish" the palette
// sweep by changing this line.
const FEELING_COLOR = { 1: '#c0554d', 2: '#d07d45', 3: '#c8861d', 4: '#b6c24a', 5: '#2fa06d' }

// Shared card surface for the Progress screen sections.
const CARD = { background: '#1a2840', border: '1px solid rgba(245,168,26,0.16)', borderRadius: '12px', padding: '20px' }

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
  if (s === 1) return 'Great start. One day down.'
  if (s < 4) return 'You’re building momentum.'
  if (s < 7) return 'You’re on a roll!'
  return 'Incredible consistency.'
}

const avgFeeling = arr => { const fs = arr.filter(d => d.feeling != null).map(d => d.feeling); return fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null }

// Gentle, never-clinical read on the last 30 days (recent week vs the week before).
function trendMessage(days) {
  const recent = avgFeeling(days.slice(-7)), prev = avgFeeling(days.slice(-14, -7))
  if (recent == null) return 'Check in to start building your trend.'
  if (prev == null) return 'Keep checking in to see your trend take shape.'
  if (recent >= prev + 0.4) return 'You’re trending up lately.'
  if (recent <= prev - 0.4) return 'Some tougher days recently. Gentle steps still count.'
  return 'You’re holding steady. Consistency matters most.'
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
    try {
      // One API call returns the 30-day window (ordered) plus the all-time total.
      const { checkins, total } = await api.getMyCheckins(since.toISOString())
      const rows = checkins || []
      const days = build30Days(rows)
      setWeek(buildWeek(rows))
      setHistory(days)
      setStreak(streakFromDays(days))
      setTotalCheckins(total || 0)
    } catch (err) {
      console.log('Load error:', err.message)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const weekCount = week.filter(d => d.done).length
  const today = new Date()
  // No year: this is today's check-in, so the year is noise, and dropping it
  // keeps the line a timestamp rather than a full date. Display only — nothing
  // is stored from this string.
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const toggleMovement = (item) => {
    setMovements(prev => prev.includes(item) ? prev.filter(m => m !== item) : [...prev, item])
  }

  const handleSubmit = async () => {
    setLoading(true)
    let response = "You showed up today, and that's everything."

    try {
      const allMovements = [...movements, ...(otherMovement.trim() ? [otherMovement.trim()] : [])]
      const movementText = allMovements.length > 0 ? allMovements.join(', ') : 'nothing logged'
      const noteText = note.trim() ? note.trim() : 'no note added'
      const feelingWord = selectedFeeling ? feelingData[selectedFeeling].word : 'not rated'
      const isPlanningTo = movements.includes('Planning to do my exercises')

      const prompt = `You are GlowPT, a warm and encouraging wellness companion for physical therapy patients. Write a short, personal response (3-4 sentences max) for ${firstName} based on their daily check-in. Be warm, specific, and uplifting, never clinical. Use their name once.

Their check-in today:
- Feeling score: ${selectedFeeling || 'not rated'} out of 5 (${feelingWord})
- Movement: ${movementText}${isPlanningTo ? ' (note: they are planning to do their exercises later today, not done yet)' : ''}
- Their note: "${noteText}"

Respond directly to ${firstName} in second person. Reference what they actually shared. End with one gentle encouragement. Never join two clauses with a dash of any kind, not an em dash, an en dash or a hyphen. Use a period or a comma instead. Hyphens inside words like check-in are fine.`

      // The reflection now comes from POST /ai-response (behind the Cognito
      // authorizer). Falls back gracefully on any error.
      const r = await api.aiResponse(prompt)
      // The house dash rule is enforced here rather than trusted to the prompt.
      // See lib/houseVoice.js: the model has now ignored two versions of the
      // instruction, most recently in a real patient's reflection.
      if (r?.response) response = stripClauseDashes(r.response)
    } catch (err) {
      console.log('AI error:', err.message)
    }

    // The server derives user_id + clinic_id from the verified token and enforces
    // one check-in per UTC day (upsert), so the payload is just the check-in data
    // and the same-day re-entry logic no longer lives in the client.
    const payload = {
      feeling: selectedFeeling,
      feeling_word: selectedFeeling ? feelingData[selectedFeeling].word : '',
      movements,
      other_movement: otherMovement.trim() || null,
      note,
      ai_response: response,
    }
    try {
      await api.saveCheckin(payload)
    } catch (err) {
      console.log('Save error:', err.message)
    }

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
    // textAlign is declared HERE, not inherited from #root — see src/index.css.
    // Covers both branches of this screen, the loading splash and the app.
    app: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", WebkitFontSmoothing: 'antialiased', textAlign: 'center' },
    screen: { maxWidth: '430px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0' },
    welcomeWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px 32px 48px', minHeight: '100vh' },
    welcomeTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '0px' },
    logoFloat: { marginBottom: '16px', animation: 'float 4s ease-in-out infinite' },
    wordmark: { display: 'flex', alignItems: 'baseline', marginBottom: '12px' },
    logoGlow: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: '57px', color: '#f5efe4', letterSpacing: '-0.03em', lineHeight: 1 },
    logoPT: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: '57px', color: BRAND, letterSpacing: '-0.02em', lineHeight: 1 },
    tagline: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: '21px', color: 'rgba(245,168,26,0.85)', textAlign: 'center', letterSpacing: '0.01em', lineHeight: 1.2 },
    welcomeMiddle: { textAlign: 'center', padding: '0 8px' },
    greeting: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '36px', lineHeight: 1.3, color: '#f5efe4', marginBottom: '36px', letterSpacing: '-0.01em' },
    greetingEm: { color: '#FBC02D' },
    welcomeSub: { fontSize: '15px', lineHeight: 1.6, color: 'rgba(245,239,228,0.5)', maxWidth: '30ch', margin: '0 auto' },
    welcomeBottom: { display: 'flex', flexDirection: 'column', gap: '14px' },
    btnPrimary: { width: '100%', padding: '18px 24px', border: 'none', borderRadius: '4px', background: '#F5A81A', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em' },
    btnSecondary: { width: '100%', padding: '18px 24px', border: '1px solid rgba(245,239,228,0.15)', borderRadius: '4px', background: 'transparent', color: 'rgba(245,239,228,0.7)', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 500, cursor: 'pointer' },
    btnGhost: { width: '100%', padding: '12px', border: 'none', background: 'transparent', color: 'rgba(245,239,228,0.5)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', cursor: 'pointer' },
    // 20px above the logo matches welcomeWrap and responseTop; it was 56px when
    // the date was the first thing on this screen.
    checkinHeader: { padding: '20px 28px 24px' },
    // CARD_LABEL_SIZE, not LABEL_SIZE, deliberately. This is a timestamp, not a
    // section label: it is the longest string in the small-label family (26
    // characters), so at 22px it rendered as a 304px full-width band of brand
    // amber and competed with the 32px question it introduces — the tier rule
    // "a label must not outgrow what it introduces" failing in spirit rather
    // than in arithmetic. It was 12px until the 2026-09-04 sweep; 15 matches
    // "Body Check" further down the same screen.
    checkinDate: { fontSize: CARD_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: '8px' },
    checkinTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '32px', lineHeight: 1.15, color: '#f5efe4', letterSpacing: '-0.02em' },
    checkinTitleEm: { fontStyle: 'italic', color: '#FBC02D' },
    checkinBody: { padding: '8px 28px 40px', display: 'flex', flexDirection: 'column', gap: '28px' },
    qBlock: { display: 'flex', flexDirection: 'column', gap: '14px' },
    qLabel: { fontSize: CARD_LABEL_SIZE, fontWeight: 600, color: 'rgba(245,239,228,0.7)', letterSpacing: '0.01em' },
    qQuestion: { fontFamily: "'Fraunces', serif", fontWeight: 400, fontSize: '20px', lineHeight: 1.3, color: '#f5efe4', letterSpacing: '-0.01em' },
    feelingScale: { display: 'flex', gap: '10px', justifyContent: 'space-between' },
    feelingBtn: (selected) => ({ flex: 1, border: `1px solid ${selected ? '#F5A81A' : 'rgba(245,239,228,0.12)'}`, borderRadius: '6px', background: selected ? '#F5A81A' : '#1a2840', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '14px 6px 10px', gap: '6px', transform: selected ? 'scale(1.06)' : 'scale(1)', transition: 'all 0.2s', boxShadow: selected ? '0 4px 18px rgba(245,168,26,0.4)' : 'none' }),
    feelingNum: (selected) => ({ fontFamily: "'Fraunces', serif", fontSize: '36px', fontWeight: selected ? 600 : 400, color: selected ? '#0d1825' : 'rgba(245,239,228,0.7)', lineHeight: 1 }),
    feelingEmoji: { fontSize: '20px', lineHeight: 1 },
    feelingWord: (selected) => ({ fontSize: '10px', color: selected ? 'rgba(13,24,37,0.75)' : 'rgba(245,239,228,0.35)', fontWeight: 500, letterSpacing: '0.04em', textAlign: 'center', lineHeight: 1.2 }),
    movementList: { display: 'flex', flexDirection: 'column', gap: '10px' },
    movementItem: (checked) => ({ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', background: checked ? 'rgba(245,168,26,0.08)' : '#1a2840', border: `1px solid ${checked ? '#F5A81A' : 'rgba(245,239,228,0.08)'}`, borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }),
    checkBox: (checked) => ({ width: '22px', height: '22px', border: `1.5px solid ${checked ? '#F5A81A' : 'rgba(245,239,228,0.25)'}`, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: checked ? '#F5A81A' : 'transparent', transition: 'all 0.2s' }),
    movementLabel: (checked) => ({ fontSize: '15px', color: checked ? '#f5efe4' : 'rgba(245,239,228,0.7)', fontWeight: checked ? 500 : 400 }),
    noteField: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: '15px', lineHeight: 1.6, resize: 'none', outline: 'none', minHeight: '90px' },
    responseWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 28px 48px', minHeight: '100vh' },
    responseTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: '20px' },
    responseMark: { marginBottom: '32px', position: 'relative' },
    responseEyebrow: { fontSize: LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: '20px' },
    responseMessage: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '22px', lineHeight: 1.55, color: '#f5efe4', letterSpacing: '-0.01em', marginBottom: '32px', maxWidth: '34ch' },
    statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', width: '100%', marginBottom: '28px' },
    statCard: { background: '#1a2840', border: '1px solid rgba(245,168,26,0.2)', borderRadius: '4px', padding: '16px', textAlign: 'left' },
    statLabel: { fontSize: CARD_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: '6px' },
    statValue: { fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 400, color: '#f5efe4', letterSpacing: '-0.02em', lineHeight: 1 },
    statSub: { fontSize: '12px', color: 'rgba(245,239,228,0.5)', marginTop: '4px', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
    streakSection: { width: '100%', marginBottom: '8px' },
    streakLabel: { fontSize: LABEL_SIZE, letterSpacing: '0.01em', color: 'rgba(245,239,228,0.5)', fontWeight: 600, marginBottom: '12px' },
    streakDots: { display: 'flex', gap: '8px', justifyContent: 'center' },
    streakDot: (done, isToday) => ({ width: '38px', height: '38px', borderRadius: '50%', background: isToday ? '#F5A81A' : done ? 'rgba(251,192,45,0.15)' : '#1a2840', border: `1px solid ${done || isToday ? '#F5A81A' : 'rgba(245,239,228,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: isToday ? '#0d1825' : done ? '#FBC02D' : 'rgba(245,239,228,0.5)', fontWeight: isToday ? 700 : 600, cursor: done ? 'pointer' : 'default', boxShadow: isToday ? '0 4px 14px rgba(245,168,26,0.4)' : 'none', transition: 'all 0.2s' }),
    streakHint: { fontSize: '11px', color: 'rgba(245,239,228,0.35)', fontStyle: 'italic', fontFamily: "'Fraunces', serif", textAlign: 'center', marginTop: '10px' },
    // Progress screen
    progressWrap: { display: 'flex', flexDirection: 'column', minHeight: '100vh' },
    progressHeader: { padding: '56px 28px 18px' },
    progressBack: { fontSize: '13px', color: '#F5A81A', fontWeight: 600, letterSpacing: '0.01em', cursor: 'pointer', marginBottom: '18px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    progressTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '34px', color: '#f5efe4', letterSpacing: '-0.02em', lineHeight: 1.1 },
    progressSub: { fontSize: '14px', color: 'rgba(245,239,228,0.5)', marginTop: '8px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
    progressBody: { padding: '8px 28px 40px', display: 'flex', flexDirection: 'column', gap: '26px', flex: 1 },
    streakHero: { background: 'linear-gradient(135deg, rgba(245,168,26,0.16), rgba(13,24,37,0))', border: '1px solid rgba(245,168,26,0.28)', borderRadius: '10px', padding: '26px 20px', textAlign: 'center' },
    streakBig: { fontFamily: "'Fraunces', serif", fontWeight: 400, fontSize: '66px', color: '#FBC02D', lineHeight: 1, letterSpacing: '-0.03em' },
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
    journalBack: { fontSize: '13px', color: '#F5A81A', fontWeight: 600, letterSpacing: '0.01em', cursor: 'pointer', marginBottom: '20px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    journalDayName: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '36px', lineHeight: 1.1, color: '#FBC02D', letterSpacing: '-0.02em', fontStyle: 'italic' },
    journalDateSub: { fontSize: '13px', color: 'rgba(245,239,228,0.5)', marginTop: '6px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
    journalBody: { padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '60px' },
    journalSection: { display: 'flex', flexDirection: 'column', gap: '10px' },
    journalSectionLabel: { fontSize: SECTION_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600 },
    journalFeelingDisplay: { display: 'flex', alignItems: 'center', gap: '16px', background: '#1a2840', border: '1px solid rgba(245,168,26,0.2)', borderRadius: '4px', padding: '18px' },
    journalFeelingEmoji: { fontSize: '36px', lineHeight: 1 },
    journalFeelingNum: { fontFamily: "'Fraunces', serif", fontSize: '36px', fontWeight: 400, color: '#FBC02D', letterSpacing: '-0.03em', lineHeight: 1 },
    journalFeelingDesc: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '15px', color: 'rgba(245,239,228,0.7)', lineHeight: 1.4 },
    journalMovementTag: { display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(245,168,26,0.08)', border: '1px solid rgba(245,168,26,0.25)', borderRadius: '4px' },
    journalMovementLabel: { fontSize: '14px', color: 'rgba(245,239,228,0.7)', fontWeight: 500 },
    journalNote: { background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '18px', fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '16px', lineHeight: 1.65, color: 'rgba(245,239,228,0.7)' },
    journalAI: { background: 'linear-gradient(135deg, rgba(245,168,26,0.08) 0%, rgba(13,24,37,0) 100%)', border: '1px solid rgba(245,168,26,0.2)', borderRadius: '4px', padding: '22px', position: 'relative', overflow: 'hidden' },
    journalAILabel: { fontSize: CARD_LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: '14px' },
    journalAIText: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '19px', lineHeight: 1.55, color: '#f5efe4', letterSpacing: '-0.01em' },
    loadingWrap: { position: 'fixed', inset: 0, background: '#0d1825', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', zIndex: 100 },
    loadingText: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '18px', color: 'rgba(245,239,228,0.5)', animation: 'breathe 2s ease-in-out infinite' },
    loadingDots: { display: 'flex', gap: '8px' },
    loadingDot: (i) => ({ width: '8px', height: '8px', borderRadius: '50%', background: '#F5A81A', animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite` }),
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
    textarea:focus { border-color: rgba(245,168,26,0.4) !important; outline: none; }
    input:focus { border-color: rgba(245,168,26,0.4) !important; }
    button:active { opacity: 0.85; }`

  if (loading) return (
    <div style={styles.app}>
      <style>{fontStyle}</style>
      <div style={styles.loadingWrap}>
        <LogoMark size={120} marginBottom={0} />
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
            <button style={styles.signOut} onClick={signOut}>Sign Out</button>
            <div style={styles.welcomeTop}>
              <div style={styles.logoFloat}><LogoMark size={208} marginBottom={0} /></div>
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
              <button style={styles.btnPrimary} onClick={startNewCheckin}>Start Today's Check-In →</button>
              {totalCheckins > 0 && (
                <button style={styles.btnSecondary} onClick={() => setScreen('progress')}>View My Progress</button>
              )}
            </div>
          </div>
        )}

        {screen === 'checkin' && (
          <div>
            <div style={styles.checkinHeader}>
              <LogoMark size={132} marginBottom={16} />
              <div style={styles.checkinDate}>{dateStr}</div>
              <div style={styles.checkinTitle}>How are you<br /><span style={styles.checkinTitleEm}>feeling today?</span></div>
            </div>
            <div style={styles.checkinBody}>
              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Body Check</div>
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
                          style={{ background: 'rgba(245,239,228,0.06)', border: '1px solid rgba(245,168,26,0.3)', borderRadius: '4px', padding: '10px 14px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                      </div>
                    )
                  })()}
                </div>
              </div>

              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Anything Else?</div>
                <div style={styles.qQuestion}>A moment, a win, a thought.</div>
                <textarea style={styles.noteField} placeholder="Felt a little stiff this morning but loosened up after my walk…" rows={3} value={note} onChange={e => setNote(e.target.value)} />
              </div>

              <button style={{ ...styles.btnPrimary, marginTop: '8px' }} onClick={handleSubmit}>Save Today's Check-In →</button>
              <div style={{ height: '20px' }} />
            </div>
          </div>
        )}

        {screen === 'progress' && (
          <div style={styles.progressWrap}>
            <div style={styles.progressHeader}>
              <div style={styles.progressBack} onClick={() => setScreen('welcome')}>← Back</div>
              <div style={styles.progressTitle}>Your Progress</div>
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
                  <div style={styles.statLabel}>This Week</div>
                  <div style={styles.statValue}>{weekCount}</div>
                  <div style={styles.statSub}>{weekCount === 1 ? 'day' : 'days'} checked in</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>All Time</div>
                  <div style={styles.statValue}>{totalCheckins}</div>
                  <div style={styles.statSub}>check-in{totalCheckins === 1 ? '' : 's'}</div>
                </div>
              </div>

              <div style={styles.trendSection}>
                <div style={styles.streakLabel}>Your Month</div>
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
                          <div style={styles.monthAvgWord}>Mostly {feelingData[sum.rounded].word.toLowerCase()} · {sum.count} check-in{sum.count === 1 ? '' : 's'} in 30 days</div>
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
                <div style={{ ...styles.streakLabel, paddingLeft: '4px' }}>This Week · Tap a Day</div>
                <div style={{ ...styles.streakDots, justifyContent: 'space-between', gap: '4px' }}>
                  {week.map(d => (
                    <div key={d.id} style={styles.streakDot(d.done, d.today)} onClick={() => openJournal(d)}>{d.day}</div>
                  ))}
                </div>
                <div style={styles.streakHint}>Tap a completed day to read your entry.</div>
              </div>
            </div>

            <div style={{ ...styles.responseBottom, padding: '0 28px 40px' }}>
              {week.find(d => d.today)?.done
                ? <button style={styles.btnPrimary} onClick={() => setScreen('welcome')}>Done ✓</button>
                : <button style={styles.btnPrimary} onClick={startNewCheckin}>Start Today's Check-In →</button>}
            </div>
          </div>
        )}

        {screen === 'response' && (
          <div style={styles.responseWrap}>
            <div style={styles.responseTop}>
              <div style={styles.responseMark}>
                <div style={{ position: 'absolute', inset: '-12px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(251,192,45,0.2) 0%,transparent 70%)', animation: 'pulse 2.5s ease-in-out infinite' }} />
                <LogoMark size={132} marginBottom={0} />
              </div>
              {aiResponse && <div style={styles.responseEyebrow}>Today's Reflection</div>}
              {aiResponse && <div style={styles.responseMessage}>{aiResponse}</div>}

              <div style={styles.statsRow}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>Today's Feeling</div>
                  <div style={{ fontSize: '22px', marginBottom: '4px' }}>{selectedFeeling ? feelingData[selectedFeeling].emoji : '—'}</div>
                  <div style={styles.statValue}>{selectedFeeling || '—'}</div>
                  <div style={styles.statSub}>{selectedFeeling ? feelingData[selectedFeeling].word : 'out of 5'}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>This Week</div>
                  <div style={styles.statValue}>{weekCount}</div>
                  <div style={styles.statSub}>{weekCount === 1 ? 'day' : 'days'} checked in</div>
                </div>
              </div>

              <div style={styles.streakSection}>
                <div style={styles.streakLabel}>Your Week · Tap Any Day</div>
                <div style={styles.streakDots}>
                  {week.map(d => (
                    <div key={d.id} style={styles.streakDot(d.done, d.today)} onClick={() => openJournal(d)}>{d.day}</div>
                  ))}
                </div>
                <div style={styles.streakHint}>Tap a completed day to read your entry.</div>
              </div>
            </div>

            <div style={styles.responseBottom}>
              <button style={styles.btnPrimary} onClick={() => setScreen('welcome')}>Done for Today ✓</button>
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
                <div style={styles.journalSectionLabel}>Body Feeling</div>
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
                        <svg width="14" height="11" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#F5A81A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span style={styles.journalMovementLabel}>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {journalDay.note && (
                <div style={styles.journalSection}>
                  <div style={styles.journalSectionLabel}>Your Note</div>
                  <div style={styles.journalNote}>{journalDay.note}</div>
                </div>
              )}

              {journalDay.response && (
                <div style={styles.journalSection}>
                  <div style={styles.journalSectionLabel}>Today's Reflection</div>
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
