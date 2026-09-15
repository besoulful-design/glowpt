/**
 * THE ONE EMAIL SHELL. Every email GlowPT sends is built from this file.
 *
 * ⚠️ IT IS SHARED BY TWO LAMBDAS ON PURPOSE (glowpt-api for invites,
 * glowpt-weekly-summary for the Sunday mail). Before 2026-09-14 each one
 * carried its own copy of the markup and the two had already drifted: the
 * invite's text-opacity ladder had six steps and the weekly's had four.
 * esbuild bundles this into both function packages, so there is no runtime
 * dependency and no Lambda layer to keep in sync. One declaration.
 *
 * ⛔ NO LADDER OF ANY KIND. Body copy is ONE color AND ONE SIZE, always.
 *
 * This is THE rule in this file, and it is the only thing from 2026-09-14 that
 * was never in doubt. The email used to fade each paragraph a step further
 * (1.0, 0.8, 0.6, 0.5, 0.35 alpha) and run five font sizes (17/16/15/14/13) to
 * imply hierarchy. David on the shades: "Absolutely get rid of the ladder
 * entirely!!! I hate it!!!" And on the sizes, after only the shades were fixed:
 * "make ALL the fonts one size... That last paragraph and last line looks god
 * awful smaller." Both are gone. Hierarchy comes from weight and from the
 * button, which no mail client rewrites.
 *
 * ⛔ DO NOT WRITE A font-size INTO A CALL SITE. Build paragraphs with
 * emailText() and the rule cannot be broken by accident, which is the same
 * reason AuthShell.jsx owns the label sizes rather than each screen.
 *
 * ⚠️ THE CARD IS NAVY AND THAT IS SETTLED. It went white for one evening on
 * 2026-09-14 and came back, and the round trip is worth understanding before
 * anyone repeats it. GMAIL'S iOS APP INVERTS THIS EMAIL IN DARK MODE and
 * ignores the color-scheme meta entirely (proven on David's phone that day:
 * the white version arrived near-black, the navy version arrives pale). White
 * was tried because a light email is the direction clients fight least. It
 * turned out not to matter, because Gmail flips whatever it is given, and
 * David's verdict on seeing both was that the navy is the one he wants and the
 * flip is fine: "I know the iphone will flip it to white in dark mode, that's
 * fine." The real fixes were the size and the ladder, not the background.
 *
 * ⚠️ WHAT THE ROUND TRIP ACTUALLY TAUGHT, AND THE ONLY COLOR RULE HERE:
 * Gmail's dark mode flips lightness. A color that is DARK on a light ground
 * comes back LIGHT, and a color that is LIGHT comes back DARK. So a design is
 * safe in both directions exactly when its contrast does not depend on which
 * end of the scale a color sits at. Every color below is either clearly light
 * or clearly dark against its own background, never in the middle. THE ONE
 * THING THAT CANNOT WORK is a value close to its background's lightness: it has
 * nowhere to go when flipped. That killed a pale gray frame and a bright amber
 * wordmark on white, in that order, on the same evening.
 */

// The single ink. Warm off-white on navy, ~15:1, and the ONLY color body copy
// ever takes. This is the house cream, the same one the navy email always used,
// rather than pure #ffffff, which is colder than the brand anywhere else.
export const EMAIL_INK = '#f5efe4';

// The card, and the panel inside it that the clinic email's numbers sit on.
export const EMAIL_BG = '#0d1825';
export const EMAIL_PANEL = '#1a2840';

// Divider above the sign-off. It does the separating that the faded text used
// to do, without dimming anything.
export const EMAIL_HAIRLINE = '#2a3a52';

// The button: amber field, navy label, exactly as in the app.
export const EMAIL_AMBER = '#F5A81A';

// The "PT" in the wordmark, and nothing else.
//
// ⚠️ IT IS THE BRIGHT ACCENT AGAIN, AND ONLY BECAUSE THE CARD IS NAVY. On
// white this same value was unreadable both ways: barely 1.66:1 in light mode,
// and flipped to a dark brown that sank into the dark card. On navy it is the
// HIGH-contrast choice, and when Gmail flips the card to white it lands as a
// deep amber on a light ground, which reads perfectly well. Same color, both
// directions, because the background moved to where it belongs.
//
// ⛔ IF ANYONE EVER PUTS THIS EMAIL BACK ON A LIGHT CARD, THIS VALUE MUST GO
// DARK AGAIN (#B0730A was the value that worked). Bright amber and a light
// card cannot coexist. That is the whole of what 2026-09-14 cost.
export const EMAIL_WORDMARK_AMBER = '#FBC02D';

// THE one body size. Every paragraph in every email is this, and emailText()
// is the only thing that may write it. See the no-ladder note above.
export const EMAIL_TEXT_SIZE = 16;

const FONT = '-apple-system,Segoe UI,sans-serif';

/**
 * Wrap the body of an email in the GlowPT shell.
 *
 * Returns a complete HTML document rather than a bare <div>, so the head can
 * declare the color scheme. Gmail ignores that; other clients honor it.
 *
 * ⛔ NO FRAME. A 3px border was tried in both amber and navy on 2026-09-14 and
 * David's answer was "I didn't like the big blue border anyway". The card is
 * its own frame once it is navy on a white page, which is the arrangement a
 * frame was invented to fake.
 */
export function emailShell(appUrl: string, inner: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_BG}">
  <div style="font-family:${FONT};background-color:${EMAIL_BG};color:${EMAIL_INK};border-radius:8px;padding:32px;max-width:480px;margin:auto">
    <img src="${appUrl}/apple-touch-icon.png" alt="GlowPT" width="56" height="56" style="display:block;width:56px;height:56px;border:0;border-radius:13px;margin-bottom:12px">
    <div style="font-size:26px;font-weight:600;margin-bottom:18px;color:${EMAIL_INK}">Glow<span style="color:${EMAIL_WORDMARK_AMBER}">PT</span></div>
    ${inner}
  </div>
</body>
</html>`;
}

/**
 * A paragraph. THE ONLY WAY TO PUT COPY IN AN EMAIL.
 *
 * Takes the gap above it, because that is the one thing a paragraph legitimately
 * varies. It does NOT take a size or a color: those are the rule, not a choice.
 */
export function emailText(inner: string, marginTop = 14) {
  return `<p style="font-size:${EMAIL_TEXT_SIZE}px;line-height:1.6;margin:${marginTop}px 0 0;color:${EMAIL_INK}">${inner}</p>`;
}

/**
 * A paragraph that can raise its voice. Same size as every other line, because
 * the no-ladder rule is absolute; the ONLY thing that changes is hue, and only
 * when `loud` is true.
 *
 * ⚠️ Bright amber is a signal HERE and nowhere else in the copy, and it works
 * only because the card is navy. See EMAIL_WORDMARK_AMBER.
 */
export function emailAlert(inner: string, loud: boolean) {
  const color = loud ? EMAIL_WORDMARK_AMBER : EMAIL_INK;
  return `<p style="font-size:${EMAIL_TEXT_SIZE}px;line-height:1.6;margin:8px 0 0;color:${color}">${inner}</p>`;
}

/** The single call to action. Amber field, navy label, never a bare link. */
export function emailButton(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:14px;background-color:${EMAIL_AMBER};color:${EMAIL_BG};text-decoration:none;font-weight:600;font-size:${EMAIL_TEXT_SIZE}px;padding:12px 22px;border-radius:4px">${label}</a>`;
}

/**
 * The sign-off. Every email ends with it, at the same size as everything else,
 * with the hairline marking it rather than a smaller or fainter type.
 */
export function emailSignOff() {
  return `<p style="font-size:${EMAIL_TEXT_SIZE}px;line-height:1.6;color:${EMAIL_INK};margin:26px 0 0;padding-top:18px;border-top:1px solid ${EMAIL_HAIRLINE}">One good day at a time.</p>`;
}
