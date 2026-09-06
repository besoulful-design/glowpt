import { FEELINGS } from '../lib/feelings'

// THE 1–5 FEELING SCALE, RENDERED ONCE FOR THE WHOLE APP.
//
// The patient taps this on the check-in screen; the clinic dashboard shows the
// same thing as the legend above the roster. Until 2026-09-06 those were TWO
// hand-written copies (PatientApp `feelingScale`, Dashboard `legendScale`),
// and David asked three times in two days why they did not look the same. They
// could not: every size and colour was retyped in each file. Now there is one
// component, so the two screens cannot drift. Same rule as lib/feelings.js and
// LogoMark, and for the same reason.
//
// SIZES (David, 2026-09-06). THE CARD IS THE OLD PATIENT CHECK-IN CARD: same
// padding, same gaps, same height, same air. That is the one he called nice.
// Inside it the FACE is now the hero at 36px, the size the numeral used to be,
// and the numeral is one step down at 26. ⛔ THE FIRST ATTEMPT GOT THIS
// BACKWARDS: it kept the old manager legend's small 22px numeral, nudged the
// face to 30, and shrank the patient card to match, so BOTH screens ended up
// looking like the cramped legend he had complained about. He said so, in
// capitals. Do not shrink this card to make it "fit"; it fits.
const FACE_SIZE = 36
const NUM_SIZE = 26
const WORD_SIZE = 10

const styles = {
  scale: { display: 'flex', gap: 10, justifyContent: 'space-between' },
  cell: (selected, interactive) => ({
    flex: 1, minWidth: 0,
    border: `1px solid ${selected ? '#F5A81A' : 'rgba(245,239,228,0.12)'}`,
    borderRadius: 6,
    background: selected ? '#F5A81A' : '#1a2840',
    cursor: interactive ? 'pointer' : 'default',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '14px 6px 10px', gap: 6,
    transform: selected ? 'scale(1.06)' : 'scale(1)',
    transition: 'all 0.2s',
    boxShadow: selected ? '0 4px 18px rgba(245,168,26,0.4)' : 'none',
  }),
  // A fixed-height flex box, not a bare text node: emoji glyphs carry uneven
  // ascent per platform, so without this the faces sit at slightly different
  // heights in different cells.
  face: { fontSize: FACE_SIZE, lineHeight: 1, height: FACE_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  num: (selected) => ({
    fontFamily: "'Fraunces', serif", fontSize: NUM_SIZE, lineHeight: 1,
    fontWeight: selected ? 600 : 400,
    color: selected ? '#0d1825' : 'rgba(245,239,228,0.7)',
  }),
  word: (selected) => ({
    fontSize: WORD_SIZE, lineHeight: 1.2, letterSpacing: '0.04em', fontWeight: 500, textAlign: 'center',
    color: selected ? 'rgba(13,24,37,0.75)' : 'rgba(245,239,228,0.4)',
  }),
}

// `selected` is the chosen rating (or null); `onSelect(n)` makes the cells
// tappable. Leave `onSelect` out and it renders as a static legend.
export default function FeelingScale({ selected = null, onSelect, style }) {
  const interactive = typeof onSelect === 'function'
  return (
    <div style={{ ...styles.scale, ...style }}>
      {[1, 2, 3, 4, 5].map(n => {
        const sel = selected === n
        return (
          <div
            key={n}
            style={styles.cell(sel, interactive)}
            onClick={interactive ? () => onSelect(n) : undefined}
            role={interactive ? 'button' : undefined}
            aria-pressed={interactive ? sel : undefined}
            title={interactive ? undefined : FEELINGS[n].word}
          >
            <div style={styles.face}>{FEELINGS[n].emoji}</div>
            <div style={styles.num(sel)}>{n}</div>
            <div style={styles.word(sel)}>{FEELINGS[n].word}</div>
          </div>
        )
      })}
    </div>
  )
}
