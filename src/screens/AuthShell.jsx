// Shared shell + styling for the auth screens (Join / Login), matching GlowPT's brand.

// The one and only GlowPT mark. Do NOT re-declare this in a screen file —
// it used to exist twice (here and inside PatientApp) and the copies drifted.
// Matches public/favicon.svg: same sunrise, drawn to glow on the dark shell
// instead of sitting in a tile. marginBottom is a prop because the patient
// screens lay the mark out themselves.
export function LogoMark({ size = 200, marginBottom = 20 }) {
  return (
    <svg width={size} height={Math.round(size * 0.58)} viewBox="0 0 130 75" fill="none" style={{ marginBottom }}>
      <defs>
        <radialGradient id="haze" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="#F5A81A" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F5A81A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="horizon" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#DD7A14" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFC523" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#DD7A14" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="65" cy="72" rx="58" ry="20" fill="url(#haze)" />
      <path d="M52 69.8Q39.7 70.4 27.4 71.2Q39.7 72.5 52 73.7Z" fill="#F5A81A" opacity="0.90" />
      <path d="M52.8 67.2Q37.8 64.4 22.8 61.8Q37.4 66.4 51.9 70.7Z" fill="#FFC523" opacity="0.76" />
      <path d="M54.4 64.1Q42.2 59.4 29.9 55Q41 61.9 52.2 68.6Z" fill="#E9910F" opacity="0.67" />
      <path d="M55.6 62.6Q46.7 58.3 37.7 54.1Q45.1 60.8 52.6 67.2Z" fill="#F5A81A" opacity="0.68" />
      <path d="M57.8 60.9Q50.1 54.8 42.2 48.9Q48 56.8 54 64.6Z" fill="#FFC523" opacity="0.90" />
      <path d="M60.6 59.5Q55 52.1 49.2 44.8Q52.7 53.5 56.4 62Z" fill="#E9910F" opacity="0.64" />
      <path d="M62.3 59.1Q57.1 48.1 51.7 37.1Q55 48.9 58.5 60.6Z" fill="#F5A81A" opacity="0.80" />
      <path d="M63.8 58.9Q59.5 45.3 55 31.8Q57.3 45.9 59.9 59.9Z" fill="#FFC523" opacity="0.55" />
      <path d="M67.7 59.1Q67 42.8 66.1 26.6Q64.4 42.8 62.9 58.9Z" fill="#E9910F" opacity="0.81" />
      <path d="M69 59.5Q71.4 41.6 73.5 23.6Q69.4 41.2 65.5 58.9Z" fill="#F5A81A" opacity="0.65" />
      <path d="M72 60.9Q77 47.7 81.9 34.5Q75.2 46.9 68.6 59.4Z" fill="#FFC523" opacity="0.97" />
      <path d="M74 62.4Q81.1 50.3 88.1 38.1Q79.3 49 70.6 60.1Z" fill="#E9910F" opacity="0.71" />
      <path d="M75.4 64Q86.1 52.5 96.7 41Q84.9 51.3 73.2 61.8Z" fill="#F5A81A" opacity="0.75" />
      <path d="M76.9 66.3Q88.1 57.1 99.2 47.8Q86.7 55.2 74.4 62.7Z" fill="#FFC523" opacity="0.85" />
      <path d="M77.7 68.7Q91.6 62.4 105.4 55.8Q90.9 60.6 76.4 65.6Z" fill="#E9910F" opacity="0.59" />
      <path d="M78.2 71.8Q92.6 68 106.9 64Q92.1 65.6 77.3 67.3Z" fill="#F5A81A" opacity="0.77" />
      <path d="M78.2 73.6Q92.5 71.2 106.8 68.5Q92.2 68.3 77.7 68.2Z" fill="#FFC523" opacity="0.93" />
      <rect x="14" y="71.4" width="102" height="1.3" fill="url(#horizon)" />
      <circle cx="65" cy="72" r="13" fill="#F5B60C" />
      <circle cx="65" cy="72" r="10.5" fill="#FDD10B" />
      <circle cx="63.5" cy="70" r="5.5" fill="#FFE85C" />
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
