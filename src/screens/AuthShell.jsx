// Shared shell + styling for the auth screens (Join / Login), matching GlowPT's brand.

// The sun's amber, taken from the logo artwork. Import this instead of
// retyping the hex — the wordmark's "PT" must always match the mark.
export const BRAND = '#F5A81A'

// The GlowPT wordmark for use INSIDE running text ("Sign in to <Brand/>").
// "Glow" inherits whatever the surrounding type is; "PT" gets the wordmark
// treatment. There is one of these — do not hand-roll another.
export function Brand() {
  return (
    <>Glow<span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontStyle: 'normal', color: BRAND }}>PT</span></>
  )
}

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

// TWO sizes for the small-label family, which used to be 11.5 and 12 across the
// board: two arbitrary values for one class of label, and small enough that a
// clinic's own name was the tiniest text on its own sign-up screen.
//
// LABEL_SIZE is a section label standing on its own line — the clinic name under
// the logo, "Today's Reflection", "Your Week · Tap Any Day", modal titles, the
// dashboard section heads. Nothing beside it competes, so it can carry weight.
//
// SECTION_LABEL_SIZE is a section head above BODY copy — the dashboard cards
// ("Your Patient Invite Link" over a 14px URL, "Care Team" over 14.5px rows)
// and the journal's "Your Note" / "Today's Reflection" over 16-19px text.
//
// CARD_LABEL_SIZE is a label sitting inside a block, directly above the bigger
// thing it names — a 28px stat value, a 32px dashboard tile figure, a 20px
// check-in question.
//
// ⚠️ THE THREE TIERS ARE ONE RULE: a label must not outgrow what it introduces.
// Do NOT "finish the job" by collapsing them. Verified by rendering all of it
// on 2026-09-04: at 22 a stat label outgrows its own number and "Today's
// Feeling" wraps to two lines in a half-width card at phone width, and a 22px
// dashboard head dwarfs the 14px URL beneath it.
//
// Change a number here and every label of that tier follows; never retype a
// literal at a call site. Same one-declaration rule as lib/feelings.js.
export const LABEL_SIZE = 22
export const SECTION_LABEL_SIZE = 18
export const CARD_LABEL_SIZE = 15

export const ui = {
  eyebrow: { fontSize: LABEL_SIZE, letterSpacing: '0.01em', color: '#F5A81A', fontWeight: 600, marginBottom: 10 },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 34, lineHeight: 1.2, color: '#f5efe4', marginBottom: 14, letterSpacing: '-0.01em' },
  muted: { fontSize: 15, lineHeight: 1.6, color: 'rgba(245,239,228,0.55)', maxWidth: '34ch', marginBottom: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
  input: { width: '100%', background: '#1a2840', border: '1px solid rgba(245,239,228,0.12)', borderRadius: 4, padding: '15px 16px', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", fontSize: 15 },
  btn: { width: '100%', padding: '16px 24px', border: 'none', borderRadius: 4, background: '#F5A81A', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  error: { color: '#e8a0a0', fontSize: 13, textAlign: 'left' },
  // Upright DM Sans, inherited from AuthShell. It was italic Fraunces until
  // 2026-08-30: a serif italic dropped into screens that are otherwise upright
  // sans read as a different typeface rather than as quieter text. Fine print
  // is now distinguished by size and opacity alone, which is the whole job.
  fine: { fontSize: 12, color: 'rgba(245,239,228,0.35)', marginTop: 18 },

  // Modal close controls, shared by all three modals (More Info, BAA, privacy).
  // One definition on purpose, same reasoning as lib/useModal.js.
  //
  // The X is absolutely placed, so its panel needs position: 'relative'. It sits
  // INSIDE the panel's own scroll box and therefore scrolls away with the content,
  // which matches the FranklinAI site and is why the small Close at the foot is
  // kept: the X dismisses from the top, Close dismisses when you have read to the end.
  modalCloseX: { position: 'absolute', top: 10, right: 12, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'none', border: 'none', borderRadius: 4, color: 'rgba(245,239,228,0.45)', fontSize: 17, lineHeight: 1, cursor: 'pointer' },
  modalCloseBtn: { display: 'block', margin: '20px auto 0', padding: '9px 24px', borderRadius: 4, background: '#F5A81A', color: '#0d1825', fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' },
}
