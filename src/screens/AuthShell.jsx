// Shared shell + styling for the auth screens (Join / Login), matching GlowPT's brand.

// The one and only GlowPT mark. Do NOT re-declare this in a screen file —
// it used to exist twice (here and inside PatientApp) and the copies drifted.
//
// It renders public/favicon.svg DIRECTLY rather than re-drawing the artwork,
// so the browser tab, the iPhone icon and every in-app logo are literally the
// same file and physically cannot drift apart. Change the art in that one SVG
// (then re-render apple-touch-icon.png from it) and everything follows.
//
// `size` is the tile's edge length in px — the mark is square, unlike the old
// wide arc lockup, so call sites pass their own deliberate size.
export function LogoMark({ size = 136, marginBottom = 20 }) {
  return (
    <img
      src="/favicon.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{
        display: 'block',
        marginLeft: 'auto',
        marginRight: 'auto',
        marginBottom,
        borderRadius: '23%', // matches the rx of the artwork's own corners
        boxShadow: `0 0 ${Math.round(size * 0.3)}px rgba(245,168,26,0.3)`,
      }}
    />
  )
}

export function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", display: 'flex', justifyContent: 'center' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,300;9..144,0,400;9..144,1,300;9..144,1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; } body { margin: 0; background: #0d1825; }
        input::placeholder { color: rgba(245,239,228,0.35); }
        input:focus { border-color: rgba(245,168,26,0.5) !important; outline: none; }
        button:active { opacity: 0.85; }`}</style>
      <div style={{ maxWidth: 430, width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 32px 48px' }}>
        {children}
      </div>
    </div>
  )
}

export const ui = {
  eyebrow: { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#F5A81A', fontWeight: 600, marginBottom: 10 },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 34, lineHeight: 1.2, color: '#f5efe4', marginBottom: 14, letterSpacing: '-0.01em' },
  muted: { fontSize: 15, lineHeight: 1.6, color: 'rgba(245,239,228,0.55)', maxWidth: '34ch', marginBottom: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
  input: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.12)', borderRadius: 4, padding: '15px 16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: 15 },
  btn: { width: '100%', padding: '16px 24px', border: 'none', borderRadius: 4, background: '#F5A81A', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  error: { color: '#e8a0a0', fontSize: 13, textAlign: 'left' },
  fine: { fontSize: 12, color: 'rgba(245,239,228,0.35)', marginTop: 18, fontStyle: 'italic', fontFamily: "'Fraunces', serif" },
}
