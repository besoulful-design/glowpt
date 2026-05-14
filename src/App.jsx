import { useState, useEffect } from 'react'
import { supabase } from './supabase'


const feelingData = {
  1: { emoji: '😔', word: 'Really tough', response: "Glennis, some days are just hard — and that is the truth of healing. Checking in on a day like this takes real courage. Your body is not failing you. It is working hard, quietly, even when you cannot feel it." },
  2: { emoji: '😕', word: 'Hard day', response: "A hard day, Glennis — but you still showed up. Rest today. Let your body do its quiet work. The fact that you checked in means you are still in this, still caring for yourself. That matters." },
  3: { emoji: '🙂', word: 'Getting there', response: "Glennis, you showed up today — and that takes real courage. Getting there is still moving forward. One honest day at a time is exactly how this works." },
  4: { emoji: '😊', word: 'Good day', response: "A good day, Glennis. Feel that. Something is building — your body is responding, loosening, strengthening. Today is proof." },
  5: { emoji: '😄', word: 'Feeling great', response: "Glennis, a 5 — remember this morning. This is what healing feels like at its best. Your body worked hard to get here and it deserves to be celebrated. Savor it." }
}

const pastDays = [
  { id: 1, day: 'M', date: 'May 5', feeling: 4, emoji: '😊', word: 'Good day', movements: ['PT exercises', 'Walk'], note: 'Felt pretty good after my walk — less stiffness than last week.', response: 'Something is shifting, Glennis. Less stiffness, more ease — your body is responding. Today is proof that the quiet work is paying off.', done: true },
  { id: 2, day: 'T', date: 'May 6', feeling: 3, emoji: '🙂', word: 'Getting there', movements: ['Stretching'], note: 'Did my stretches but skipped the walk. Felt okay.', response: "Glennis, showing up even when it's just the minimum — that's still showing up. Stretching counts. You're doing the quiet work.", done: true },
  { id: 3, day: 'W', date: 'May 7', feeling: null, emoji: '', word: '', movements: [], note: '', response: '', done: false },
  { id: 4, day: 'T', date: 'May 8', feeling: 4, emoji: '😊', word: 'Good day', movements: ['PT exercises'], note: 'Exercises done. Knee felt a little tight but I pushed through.', response: "Pushing through when it's not easy — that's where strength comes from, Glennis. A good day with a tight knee is worth celebrating.", done: true },
  { id: 5, day: 'F', date: 'May 9', feeling: 3, emoji: '🙂', word: 'Getting there', movements: ['PT exercises'], note: 'Felt stiff getting up. Did my exercises anyway.', response: "Glennis, you showed up on a hard morning — and that takes real courage. The number doesn't tell the whole story. Doing your exercises when you didn't feel like it? That's the story.", done: true, today: true },
  { id: 6, day: 'S', date: 'May 10', feeling: null, emoji: '', word: '', movements: [], note: '', response: '', done: false },
  { id: 7, day: 'S', date: 'May 11', feeling: null, emoji: '', word: '', movements: [], note: '', response: '', done: false },
]

const LogoMark = ({ size = 110 }) => (
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

export default function App() {
  const [screen, setScreen] = useState('welcome')
  const [selectedFeeling, setSelectedFeeling] = useState(null)
  const [movements, setMovements] = useState([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [journalDay, setJournalDay] = useState(null)
  const [greeting, setGreeting] = useState('Good evening')
const [aiResponse, setAiResponse] = useState('')
  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 12) setGreeting('Good morning')
    else if (hour < 17) setGreeting('Good afternoon')
    else setGreeting('Good evening')
  }, [])

  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const toggleMovement = (item) => {
    setMovements(prev =>
      prev.includes(item) ? prev.filter(m => m !== item) : [...prev, item]
    )
  }

  const handleSubmit = async () => {
    setLoading(true)
    
    let response = "You showed up today — and that's everything."
    
    try {
      const movementText = movements.length > 0 ? movements.join(', ') : 'nothing logged'
      const noteText = note.trim() ? note.trim() : 'no note added'
      const feelingWord = selectedFeeling ? feelingData[selectedFeeling].word : 'not rated'
      
      const prompt = `You are GlowPT, a warm and encouraging wellness companion for physical therapy patients. Write a short, personal response (3-4 sentences max) for Glennis based on her daily check-in. Be warm, specific, and uplifting — never clinical. Use her name once.

Her check-in today:
- Feeling score: ${selectedFeeling || 'not rated'} out of 5 (${feelingWord})
- Movement: ${movementText}
- Her note: "${noteText}"

Respond directly to Glennis in second person. Reference what she actually shared. End with one gentle encouragement.`

      const result = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-client-side-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      
      const data = await result.json()
      if (data.content && data.content[0]) {
        response = data.content[0].text
      }
    } catch (err) {
      console.log('AI error:', err)
    }
    
    const { error } = await supabase.from('checkins').insert({
      feeling: selectedFeeling,
      feeling_word: selectedFeeling ? feelingData[selectedFeeling].word : '',
      movements: movements,
      note: note,
      ai_response: response,
    })
    
    if (error) console.log('Save error:', error)
      setAiResponse(response)
    
    setLoading(false)
    setScreen('response')
  }

  const openJournal = (day) => {
    if (!day.done) return
    setJournalDay(day)
    setScreen('journal')
  }

  const styles = {
    app: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", WebkitFontSmoothing: 'antialiased' },
    screen: { maxWidth: '430px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0' },

    // Welcome
    welcomeWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '60px 32px 48px', minHeight: '100vh' },
    welcomeTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '40px' },
    logoFloat: { marginBottom: '28px', animation: 'float 4s ease-in-out infinite' },
    wordmark: { display: 'flex', alignItems: 'baseline', marginBottom: '12px' },
    logoGlow: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: '52px', color: '#f5efe4', letterSpacing: '-0.03em', lineHeight: 1 },
    logoPT: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: '52px', color: '#c8861d', letterSpacing: '-0.02em', lineHeight: 1 },
    tagline: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '16px', color: 'rgba(200,134,29,0.75)', textAlign: 'center' },
    welcomeMiddle: { textAlign: 'center', padding: '0 8px' },
    greeting: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '28px', lineHeight: 1.3, color: '#f5efe4', marginBottom: '16px', letterSpacing: '-0.01em' },
    greetingEm: { fontStyle: 'italic', color: '#e0a035' },
    welcomeSub: { fontSize: '15px', lineHeight: 1.6, color: 'rgba(245,239,228,0.5)', maxWidth: '30ch', margin: '0 auto' },
    welcomeBottom: { display: 'flex', flexDirection: 'column', gap: '14px' },

    // Buttons
    btnPrimary: { width: '100%', padding: '18px 24px', border: 'none', borderRadius: '4px', background: '#c8861d', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em' },
    btnSecondary: { width: '100%', padding: '18px 24px', border: '1px solid rgba(245,239,228,0.15)', borderRadius: '4px', background: 'transparent', color: 'rgba(245,239,228,0.7)', fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 500, cursor: 'pointer' },
    btnGhost: { width: '100%', padding: '12px', border: 'none', background: 'transparent', color: 'rgba(245,239,228,0.5)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', cursor: 'pointer' },

    // Check-in
    checkinHeader: { padding: '56px 28px 24px' },
    checkinDate: { fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '8px' },
    checkinTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '32px', lineHeight: 1.15, color: '#f5efe4', letterSpacing: '-0.02em' },
    checkinTitleEm: { fontStyle: 'italic', color: '#e0a035' },
    checkinBody: { padding: '8px 28px 40px', display: 'flex', flexDirection: 'column', gap: '28px' },
    qBlock: { display: 'flex', flexDirection: 'column', gap: '14px' },
    qLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(245,239,228,0.7)', letterSpacing: '0.04em', textTransform: 'uppercase' },
    qQuestion: { fontFamily: "'Fraunces', serif", fontWeight: 400, fontSize: '20px', lineHeight: 1.3, color: '#f5efe4', letterSpacing: '-0.01em' },

    // Feeling scale
    feelingScale: { display: 'flex', gap: '10px', justifyContent: 'space-between' },
    feelingBtn: (selected) => ({
      flex: 1, border: `1px solid ${selected ? '#c8861d' : 'rgba(245,239,228,0.12)'}`,
      borderRadius: '6px', background: selected ? '#c8861d' : '#1a2840',
      cursor: 'pointer', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '14px 6px 10px', gap: '6px',
      transform: selected ? 'scale(1.06)' : 'scale(1)',
      transition: 'all 0.2s', boxShadow: selected ? '0 4px 18px rgba(200,134,29,0.4)' : 'none'
    }),
    feelingNum: (selected) => ({ fontFamily: "'Fraunces', serif", fontSize: '24px', fontWeight: selected ? 600 : 400, color: selected ? '#0d1825' : 'rgba(245,239,228,0.7)', lineHeight: 1 }),
    feelingEmoji: { fontSize: '20px', lineHeight: 1 },
    feelingWord: (selected) => ({ fontSize: '10px', color: selected ? 'rgba(13,24,37,0.75)' : 'rgba(245,239,228,0.35)', fontWeight: 500, letterSpacing: '0.04em', textAlign: 'center', lineHeight: 1.2 }),

    // Movement
    movementList: { display: 'flex', flexDirection: 'column', gap: '10px' },
    movementItem: (checked) => ({
      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px',
      background: checked ? 'rgba(200,134,29,0.08)' : '#1a2840',
      border: `1px solid ${checked ? '#c8861d' : 'rgba(245,239,228,0.08)'}`,
      borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s'
    }),
    checkBox: (checked) => ({
      width: '22px', height: '22px',
      border: `1.5px solid ${checked ? '#c8861d' : 'rgba(245,239,228,0.25)'}`,
      borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, background: checked ? '#c8861d' : 'transparent', transition: 'all 0.2s'
    }),
    movementLabel: (checked) => ({ fontSize: '15px', color: checked ? '#f5efe4' : 'rgba(245,239,228,0.7)', fontWeight: checked ? 500 : 400 }),

    // Note
    noteField: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: '15px', lineHeight: 1.6, resize: 'none', outline: 'none', minHeight: '90px' },

    // Response
    responseWrap: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 28px 48px', minHeight: '100vh' },
    responseTop: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: '20px' },
    responseMark: { marginBottom: '32px', position: 'relative' },
    responseEyebrow: { fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '20px' },
    responseMessage: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '24px', lineHeight: 1.45, color: '#f5efe4', letterSpacing: '-0.01em', marginBottom: '32px', maxWidth: '28ch' },
    statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', width: '100%', marginBottom: '28px' },
    statCard: { background: '#1a2840', border: '1px solid rgba(200,134,29,0.2)', borderRadius: '4px', padding: '16px', textAlign: 'left' },
    statLabel: { fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: '6px' },
    statValue: { fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 400, color: '#f5efe4', letterSpacing: '-0.02em', lineHeight: 1 },
    statSub: { fontSize: '12px', color: 'rgba(245,239,228,0.5)', marginTop: '4px', fontStyle: 'italic', fontFamily: "'Fraunces', serif" },

    // Streak
    streakSection: { width: '100%', marginBottom: '8px' },
    streakLabel: { fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,239,228,0.5)', fontWeight: 600, marginBottom: '12px' },
    streakDots: { display: 'flex', gap: '8px', justifyContent: 'center' },
    streakDot: (done, isToday) => ({
      width: '38px', height: '38px', borderRadius: '50%',
      background: isToday ? '#c8861d' : done ? 'rgba(224,160,53,0.15)' : '#1a2840',
      border: `1px solid ${done || isToday ? '#c8861d' : 'rgba(245,239,228,0.1)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '10px', color: isToday ? '#0d1825' : done ? '#e0a035' : 'rgba(245,239,228,0.5)',
      fontWeight: isToday ? 700 : 600, cursor: done ? 'pointer' : 'default',
      boxShadow: isToday ? '0 4px 14px rgba(200,134,29,0.4)' : 'none',
      transition: 'all 0.2s'
    }),
    streakHint: { fontSize: '11px', color: 'rgba(245,239,228,0.35)', fontStyle: 'italic', fontFamily: "'Fraunces', serif", textAlign: 'center', marginTop: '10px' },
    responseBottom: { width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' },

    // Journal
    journalHeader: { padding: '56px 28px 28px', borderBottom: '1px solid rgba(245,239,228,0.07)' },
    journalBack: { fontSize: '13px', color: '#c8861d', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', marginBottom: '20px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    journalDayName: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: '36px', lineHeight: 1.1, color: '#f5efe4', letterSpacing: '-0.02em', fontStyle: 'italic', color: '#e0a035' },
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

    // Loading
    loadingWrap: { position: 'fixed', inset: 0, background: '#0d1825', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', zIndex: 100 },
    loadingText: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '18px', color: 'rgba(245,239,228,0.5)', animation: 'breathe 2s ease-in-out infinite' },
    loadingDots: { display: 'flex', gap: '8px' },
    loadingDot: (i) => ({ width: '8px', height: '8px', borderRadius: '50%', background: '#c8861d', animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite` }),
  }

  if (loading) return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,0,400;9..144,1,300;9..144,1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes breathe { 0%,100%{opacity:0.5} 50%{opacity:1} }
        @keyframes dotPulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }
        * { box-sizing: border-box; }
        body { margin: 0; background: #0d1825; }
      `}</style>
      <div style={styles.loadingWrap}>
        <LogoMark size={80} />
        <div style={styles.loadingText}>Reflecting on your day…</div>
        <div style={styles.loadingDots}>
          {[0,1,2].map(i => <div key={i} style={styles.loadingDot(i)} />)}
        </div>
      </div>
    </div>
  )

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,0,400;9..144,1,300;9..144,1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes breathe { 0%,100%{opacity:0.5} 50%{opacity:1} }
        @keyframes dotPulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.15);opacity:0.4} }
        * { box-sizing: border-box; }
        body { margin: 0; background: #0d1825; }
        textarea::placeholder { color: rgba(245,239,228,0.35); font-style: italic; font-family: 'Fraunces', serif; }
        textarea:focus { border-color: rgba(200,134,29,0.4) !important; outline: none; }
        button:active { opacity: 0.85; }
      `}</style>

      <div style={styles.screen}>

        {/* ===== WELCOME ===== */}
        {screen === 'welcome' && (
          <div style={styles.welcomeWrap}>
            <div style={styles.welcomeTop}>
              <div style={styles.logoFloat}><LogoMark size={110} /></div>
              <div style={styles.wordmark}>
                <span style={styles.logoGlow}>Glow</span>
                <span style={styles.logoPT}>PT</span>
              </div>
              <div style={styles.tagline}>One good day at a time.</div>
            </div>
            <div style={styles.welcomeMiddle}>
              <div style={styles.greeting}>
                {greeting},<br />
                <span style={styles.greetingEm}>Glennis.</span>
              </div>
              <div style={styles.welcomeSub}>Your daily check-in is waiting. It only takes a moment.</div>
            </div>
            <div style={styles.welcomeBottom}>
              <button style={styles.btnPrimary} onClick={() => setScreen('checkin')}>Start today's check-in →</button>
              <button style={styles.btnSecondary} onClick={() => setScreen('checkin')}>Sign in</button>
              <button style={styles.btnGhost}>First time here? Create account</button>
            </div>
          </div>
        )}

        {/* ===== CHECK-IN ===== */}
        {screen === 'checkin' && (
          <div>
            <div style={styles.checkinHeader}>
              <div style={styles.checkinDate}>{dateStr}</div>
              <div style={styles.checkinTitle}>
                How are you<br />
                <span style={styles.checkinTitleEm}>feeling today?</span>
              </div>
            </div>
            <div style={styles.checkinBody}>

              {/* Feeling scale */}
              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Body check</div>
                <div style={styles.qQuestion}>How does your body feel right now?</div>
                <div style={styles.feelingScale}>
                  {[1,2,3,4,5].map(n => {
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

              {/* Movement */}
              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Movement</div>
                <div style={styles.qQuestion}>What did you do today?</div>
                <div style={styles.movementList}>
                  {['PT exercises', 'Walk or light activity', 'Stretching', 'Rest day'].map(item => {
                    const checked = movements.includes(item)
                    return (
                      <div key={item} style={styles.movementItem(checked)} onClick={() => toggleMovement(item)}>
                        <div style={styles.checkBox(checked)}>
                          {checked && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#0d1825" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <span style={styles.movementLabel(checked)}>{item}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Note */}
              <div style={styles.qBlock}>
                <div style={styles.qLabel}>Anything else?</div>
                <div style={styles.qQuestion}>A moment, a win, a thought.</div>
                <textarea
                  style={styles.noteField}
                  placeholder="Felt a little stiff this morning but loosened up after my walk…"
                  rows={3}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </div>

              <button style={{...styles.btnPrimary, marginTop: '8px'}} onClick={handleSubmit}>
                Save today's check-in →
              </button>
              <div style={{height: '20px'}} />
            </div>
          </div>
        )}

        {/* ===== RESPONSE ===== */}
        {screen === 'response' && (
          <div style={styles.responseWrap}>
            <div style={styles.responseTop}>
              <div style={styles.responseMark}>
                <div style={{position:'absolute',inset:'-12px',borderRadius:'50%',background:'radial-gradient(circle,rgba(224,160,53,0.2) 0%,transparent 70%)',animation:'pulse 2.5s ease-in-out infinite'}} />
                <LogoMark size={90} />
              </div>

              <div style={styles.responseEyebrow}>Today's reflection</div>
              <div style={styles.responseMessage}>
                {aiResponse}</div>

              <div style={styles.statsRow}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>Today's feeling</div>
                  <div style={{fontSize:'22px',marginBottom:'4px'}}>{selectedFeeling ? feelingData[selectedFeeling].emoji : '—'}</div>
                  <div style={styles.statValue}>{selectedFeeling || '—'}</div>
                  <div style={styles.statSub}>{selectedFeeling ? feelingData[selectedFeeling].word : 'out of 5'}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>This week</div>
                  <div style={styles.statValue}>4</div>
                  <div style={styles.statSub}>days checked in</div>
                </div>
              </div>

              <div style={styles.streakSection}>
                <div style={styles.streakLabel}>Your week — tap any day</div>
                <div style={styles.streakDots}>
                  {pastDays.map(d => (
                    <div key={d.id} style={styles.streakDot(d.done, d.today)} onClick={() => openJournal(d)}>
                      {d.day}
                    </div>
                  ))}
                </div>
                <div style={styles.streakHint}>Tap a completed day to read your entry</div>
              </div>
            </div>

            <div style={styles.responseBottom}>
              <button style={styles.btnPrimary} onClick={() => setScreen('welcome')}>Done for today ✓</button>
              <button style={styles.btnSecondary} onClick={() => setScreen('welcome')}>View my progress</button>
            </div>
          </div>
        )}

        {/* ===== JOURNAL ===== */}
        {screen === 'journal' && journalDay && (
          <div>
            <div style={styles.journalHeader}>
              <div style={styles.journalBack} onClick={() => setScreen('response')}>← Back</div>
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
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                    {journalDay.movements.map(m => (
                      <div key={m} style={styles.journalMovementTag}>
                        <svg width="14" height="11" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#c8861d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
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

              <div style={styles.journalSection}>
                <div style={styles.journalSectionLabel}>Today's reflection</div>
                <div style={styles.journalAI}>
                  <div style={styles.journalAILabel}>GlowPT</div>
                  <div style={styles.journalAIText}>{journalDay.response}</div>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  )
}