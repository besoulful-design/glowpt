import { Link } from 'react-router-dom'
import { LogoMark } from './AuthShell'

// Public front door at "/" for logged-out visitors.
// Clinics → onboard; returning patients & staff → sign in.
export default function Landing() {
  const s = {
    page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 28px 56px' },
    wrap: { maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
    wordmark: { display: 'flex', alignItems: 'baseline', marginTop: 8, marginBottom: 10 },
    glow: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: 52, color: '#f5efe4', letterSpacing: '-0.03em', lineHeight: 1 },
    pt: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 52, color: '#c8861d', letterSpacing: '-0.02em', lineHeight: 1 },
    tagline: { fontWeight: 600, fontSize: 18, color: 'rgba(200,134,29,0.85)', marginBottom: 34 },
    headline: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 30, lineHeight: 1.3, color: '#f5efe4', letterSpacing: '-0.01em', marginBottom: 16, maxWidth: '20ch' },
    sub: { fontSize: 16, lineHeight: 1.6, color: 'rgba(245,239,228,0.6)', marginBottom: 36, maxWidth: '34ch' },
    btnPrimary: { display: 'block', width: '100%', padding: '17px 24px', borderRadius: 4, background: '#c8861d', color: '#0d1825', fontSize: 16, fontWeight: 600, textDecoration: 'none', textAlign: 'center' },
    btnSecondary: { display: 'block', width: '100%', padding: '17px 24px', borderRadius: 4, background: 'transparent', color: 'rgba(245,239,228,0.8)', border: '1px solid rgba(245,239,228,0.18)', fontSize: 16, fontWeight: 500, textDecoration: 'none', textAlign: 'center', marginTop: 12 },
    btns: { width: '100%', maxWidth: 340 },
    patientNote: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,239,228,0.45)', marginTop: 26, maxWidth: '36ch' },
    footer: { fontSize: 12, color: 'rgba(245,239,228,0.3)', marginTop: 40, fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
  }

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,1,400&family=DM+Sans:wght@400;500;600&display=swap'); * { box-sizing: border-box; } body { margin: 0; background: #0d1825; } a:active { opacity: 0.85; }`}</style>
      <div style={s.wrap}>
        <LogoMark size={220} />
        <div style={s.wordmark}>
          <span style={s.glow}>Glow</span><span style={s.pt}>PT</span>
        </div>
        <div style={s.tagline}>One good day at a time.</div>

        <div style={s.headline}>A daily check-in to keep patients engaged between visits.</div>
        <div style={s.sub}>A 30-second check-in with warm, personal encouragement — so more patients finish their plan of care.</div>

        <div style={s.btns}>
          <Link to="/onboard" style={s.btnPrimary}>Bring GlowPT to your clinic →</Link>
          <Link to="/login" style={s.btnSecondary}>Sign in</Link>
        </div>

        <div style={s.patientNote}>
          Are you a patient? Use the private link your clinic gave you to get started, or sign in above if you’ve joined already.
        </div>

        <div style={s.footer}>A FranklinAI product · Philadelphia</div>
      </div>
    </div>
  )
}
