/**
 * THE ONE EMAIL SHELL. Every email GlowPT sends is built from this file.
 *
 * ⚠️ IT IS SHARED BY TWO LAMBDAS ON PURPOSE (glowpt-api for invites,
 * glowpt-weekly-summary for the Sunday mail). Before 2026-09-14 each one
 * carried its own copy of the markup and the two had already drifted: the
 * invite's text-opacity ladder had six steps, the weekly's had four, and the
 * amber in the wordmark was a different value in the Supabase-era copy still on
 * disk. esbuild bundles this into both function packages, so there is no
 * runtime dependency and no Lambda layer to keep in sync. One declaration.
 *
 * ⛔ NO LADDER OF ANY KIND. Body copy is ONE color AND ONE SIZE, always.
 * The old design faded each paragraph a little further (1.0, 0.8, 0.6, 0.5,
 * 0.35 alpha) to imply hierarchy. Two things killed it on 2026-09-14:
 *   1. David hates it, which is reason enough and is the actual instruction.
 *   2. It was never robust. The steps were tuned against a dark navy card, and
 *      Gmail's iOS app rewrites an email's colors in dark mode: it inverted the
 *      card to pale blue and left the faded lines as light gray on near-white,
 *      so the sign-off was close to unreadable. A contrast that depends on the
 *      background surviving the trip is not a contrast we control.
 * The first fix kept the fading out but let the sizes vary (17/16/15/14/13) and
 * David read that as the same ladder wearing a different hat, which it was:
 * "make ALL the fonts one size... That last paragraph and last line looks god
 * awful smaller". So EVERY paragraph is EMAIL_TEXT_SIZE now. Nothing recedes.
 * The wordmark and the button label are not body copy and keep their own sizes.
 *
 * ⛔ DO NOT WRITE A font-size INTO A CALL SITE. Build paragraphs with
 * emailText() and the rule cannot be broken by accident, which is the same
 * reason AuthShell.jsx owns the label sizes rather than each screen.
 *
 * ⚠️ WHITE, AND IT SAYS SO IN THE HEAD. The card was navy #0d1825 until
 * 2026-09-14. It is white because that is the direction a mail client is least
 * likely to fight: a light email is the ordinary case every client is built
 * around. The two color-scheme metas below declare the email light-only, which
 * is the documented way to ask a client not to re-tint it. Apple Mail honors it.
 *
 * ⚠️ GMAIL'S iOS APP IGNORES IT. PROVEN on David's phone 2026-09-14: the white
 * card comes through as near-black with white text and a brown button. The
 * metas stay because other clients do honor them, but DO NOT TRUST THEM. Assume
 * every color here will be flipped by somebody, which is the whole argument for
 * one ink and one size: a design that survives inversion is one that never
 * depended on a shade being lighter than another. David prefers the inverted
 * dark version, so this is not a bug to chase.
 */

// The single ink. Brand navy, ~16:1 on white, and the ONLY color body copy
// ever takes. See the no-ladder note above before adding a second one.
export const EMAIL_INK = '#0d1825';

// The button. Amber field, navy label, exactly as in the app.
export const EMAIL_AMBER = '#F5A81A';

// The "PT" in the wordmark and nothing else. This is the brighter accent that
// matches the sunrise artwork (#FBC02D is the top of the logo's sky gradient
// and repeats through its rays), which is what David asked for on 2026-09-14.
// ⚠️ It is deliberately NOT used for text: bright amber on white is a low
// contrast ratio, which is tolerable for two large bold letters sitting under
// the full-color logo and is not tolerable for a sentence.
export const EMAIL_AMBER_BRIGHT = '#FBC02D';

// Divider above the sign-off, and the frame around the card. Both replace work
// the old faded text used to do: they separate without dimming anything.
export const EMAIL_HAIRLINE = '#e6e8ec';
export const EMAIL_BORDER = '#d9dde3';

// THE one body size. Every paragraph in every email is this, and emailText()
// is the only thing that may write it. See the no-ladder note above.
export const EMAIL_TEXT_SIZE = 16;

const FONT = '-apple-system,Segoe UI,sans-serif';

/**
 * Wrap the body of an email in the GlowPT shell.
 *
 * Returns a complete HTML document rather than a bare <div>, because the two
 * color-scheme metas have to live in a <head> to mean anything.
 */
export function emailShell(appUrl: string, inner: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#ffffff">
  <div style="font-family:${FONT};background-color:#ffffff;color:${EMAIL_INK};border:1px solid ${EMAIL_BORDER};border-radius:10px;padding:28px;max-width:480px;margin:24px auto">
    <img src="${appUrl}/apple-touch-icon.png" alt="GlowPT" width="56" height="56" style="display:block;width:56px;height:56px;border:0;border-radius:13px;margin-bottom:12px">
    <div style="font-size:26px;font-weight:600;margin-bottom:18px;color:${EMAIL_INK}">Glow<span style="color:${EMAIL_AMBER_BRIGHT}">PT</span></div>
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

/** The single call to action. Amber field, navy label, never a bare link. */
export function emailButton(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:14px;background-color:${EMAIL_AMBER};color:${EMAIL_INK};text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:4px">${label}</a>`;
}

/**
 * The sign-off. Every email ends with it, and the hairline is what separates it
 * from the message now that nothing fades.
 */
export function emailSignOff() {
  return `<p style="font-size:${EMAIL_TEXT_SIZE}px;line-height:1.6;color:${EMAIL_INK};margin:26px 0 0;padding-top:18px;border-top:1px solid ${EMAIL_HAIRLINE}">One good day at a time.</p>`;
}
