// Shared shell + styling for the auth screens (Join / Login), matching GlowPT's brand.

export function LogoMark({ size = 200 }) {
  return (
    <svg width={size} height={Math.round(size * 0.58)} viewBox="0 0 130 75" fill="none" style={{ marginBottom: 20 }}>
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
}

export function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", display: 'flex', justifyContent: 'center' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,0,400;9..144,1,300;9..144,1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; } body { margin: 0; background: #0d1825; }
        input::placeholder { color: rgba(245,239,228,0.35); }
        input:focus { border-color: rgba(200,134,29,0.5) !important; outline: none; }
        button:active { opacity: 0.85; }`}</style>
      <div style={{ maxWidth: 430, width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 32px 48px' }}>
        {children}
      </div>
    </div>
  )
}

export const ui = {
  eyebrow: { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8861d', fontWeight: 600, marginBottom: 10 },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 34, lineHeight: 1.2, color: '#f5efe4', marginBottom: 14, letterSpacing: '-0.01em' },
  muted: { fontSize: 15, lineHeight: 1.6, color: 'rgba(245,239,228,0.55)', maxWidth: '34ch', marginBottom: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
  input: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.12)', borderRadius: 4, padding: '15px 16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: 15 },
  btn: { width: '100%', padding: '16px 24px', border: 'none', borderRadius: 4, background: '#c8861d', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  error: { color: '#e8a0a0', fontSize: 13, textAlign: 'left' },
  fine: { fontSize: 12, color: 'rgba(245,239,228,0.35)', marginTop: 18, fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
}
