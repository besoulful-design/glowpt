import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LogoMark, BRAND, ui } from './AuthShell'
import { PRICE_LINE, whatGlowptIs, CONTACT_EMAIL } from '../lib/marketing'
import { useScrollLock } from '../lib/useScrollLock'

// Public front door at "/" for logged-out visitors.
// Clinics → onboard; returning patients & staff → sign in.
export default function Landing() {
  const [showInfo, setShowInfo] = useState(false)
  useScrollLock(showInfo)

  const s = {
    page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 28px 56px' },
    wrap: { maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
    wordmark: { display: 'flex', alignItems: 'baseline', marginTop: 8, marginBottom: 10 },
    glow: { fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: 52, color: '#f5efe4', letterSpacing: '-0.03em', lineHeight: 1 },
    pt: { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 52, color: BRAND, letterSpacing: '-0.02em', lineHeight: 1 },
    tagline: { fontWeight: 600, fontSize: 18, color: 'rgba(245,168,26,0.85)', marginBottom: 34 },
    // fontStyle is stated explicitly and must stay. font-style INHERITS, and the
    // Fraunces import here loads only an upright-300 and an italic-400 instance,
    // so anything that leaves the property unset is one stray ancestor (or one
    // Safari font-matching quirk) away from rendering the hero in italic. It did.
    headline: { fontFamily: "'Fraunces', serif", fontStyle: 'normal', fontWeight: 300, fontSize: 26, lineHeight: 1.35, color: '#f5efe4', letterSpacing: '-0.01em', marginBottom: 36, maxWidth: '28ch' },
    btnPrimary: { display: 'block', width: '100%', padding: '17px 24px', borderRadius: 4, background: '#F5A81A', color: '#0d1825', fontSize: 16, fontWeight: 600, textDecoration: 'none', textAlign: 'center' },
    btnSecondary: { display: 'block', width: '100%', padding: '17px 24px', borderRadius: 4, background: 'transparent', color: 'rgba(245,239,228,0.8)', border: '1px solid rgba(245,239,228,0.18)', fontSize: 16, fontWeight: 500, textDecoration: 'none', textAlign: 'center', marginTop: 12 },
    btns: { width: '100%', maxWidth: 340 },
    patientNote: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,239,228,0.45)', marginTop: 26, maxWidth: '36ch' },
    footer: { fontSize: 12, color: 'rgba(245,239,228,0.3)', marginTop: 40, fontFamily: "'Fraunces', serif", fontStyle: 'italic' },
    moreInfo: { background: 'none', border: 'none', font: 'inherit', fontSize: 14, fontWeight: 500, color: BRAND, textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: 20 },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 },
    modal: { background: '#1a2840', border: '1px solid rgba(245,168,26,0.25)', borderRadius: 8, position: 'relative', padding: 28, maxWidth: 460, maxHeight: '80vh', overflowY: 'auto', textAlign: 'left' },
    modalHead: { fontSize: 12, fontWeight: 600, letterSpacing: '0.01em', color: BRAND, marginBottom: 14 },
    modalLead: { fontSize: 14, lineHeight: 1.65, color: 'rgba(245,239,228,0.8)', margin: '0 0 18px' },
    bullet: { display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.6, color: 'rgba(245,239,228,0.8)', marginBottom: 12 },
    tick: { color: BRAND, flexShrink: 0 },
    // The modal body is textAlign:'left' so the bullets read as a list, but the
    // footer block is a closing statement under a rule, and the Close button below
    // it is centred. Left-aligned text above a centred button read as a mistake.
    price: { fontSize: 14, lineHeight: 1.6, color: 'rgba(245,239,228,0.95)', fontWeight: 500, borderTop: '1px solid rgba(245,239,228,0.12)', paddingTop: 16, marginTop: 18, textAlign: 'center' },
    contact: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,239,228,0.6)', marginTop: 10, textAlign: 'center' },
    contactLink: { color: BRAND },
  }

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,1,400&family=DM+Sans:wght@400;500;600&display=swap'); * { box-sizing: border-box; } body { margin: 0; background: #0d1825; } a:active { opacity: 0.85; }`}</style>
      <div style={s.wrap}>
        <LogoMark size={176} />
        <div style={s.wordmark}>
          <span style={s.glow}>Glow</span><span style={s.pt}>PT</span>
        </div>
        <div style={s.tagline}>One good day at a time.</div>

        <div style={s.headline}>The GlowPT app engages patients between visits. More completed plans of care and the clinic stays full.</div>

        <div style={s.btns}>
          <Link to="/onboard" style={s.btnPrimary}>Bring GlowPT to Your Clinic →</Link>
          <Link to="/login" style={s.btnSecondary}>Sign In</Link>
        </div>

        <button type="button" style={s.moreInfo} onClick={() => setShowInfo(true)}>More Info</button>

        <div style={s.patientNote}>
          Are you a patient? Use the private link your clinic gave you to get started, or sign in above if you’ve joined already.
        </div>

        <div style={s.footer}>A FranklinAI product · Philadelphia</div>
      </div>

      {showInfo && (
        <div style={s.overlay} onClick={() => setShowInfo(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <button type="button" aria-label="Close" style={ui.modalCloseX} onClick={() => setShowInfo(false)}>✕</button>
            <div style={s.modalHead}>How GlowPT Works</div>
            <p style={s.modalLead}>{whatGlowptIs.lead}</p>
            {whatGlowptIs.points.map(point => (
              <div key={point} style={s.bullet}><span style={s.tick}>✓</span><span>{point}</span></div>
            ))}
            <div style={s.price}>{PRICE_LINE}</div>
            <div style={s.contact}>
              Questions? Email <a href={`mailto:${CONTACT_EMAIL}`} style={s.contactLink}>{CONTACT_EMAIL}</a>.
            </div>
            <button type="button" style={ui.modalCloseBtn} onClick={() => setShowInfo(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
