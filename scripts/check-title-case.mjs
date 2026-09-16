#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The house copy rule, checked by a machine instead of by eye.
//
// WHY THIS EXISTS (David, 2026-09-16): "Can't you catch any of these title case
// stragglers you keep missing." He had just found two himself, and he was right
// that it keeps happening -- a title-case miss is invisible unless you are
// looking straight at it, and nothing in the build has ever looked.
//
// THE RULE IT ENFORCES, from CLAUDE.md:
//   LABELS      (titles, buttons, pills, section heads) -> Title Case, NO period
//   STATEMENTS  (headlines, prose, empty states)        -> sentence case, period
//
// So the test is simple, and it is a BINARY (David, 2026-09-16): "If it is
// sentence case, doesn't it then need a terminal period to be correct.
// Otherwise, it should be title case." A short user-facing string that does not
// end in punctuation is therefore a label, and every word in it after the first
// must be capitalised unless it is one of the small words AP leaves alone.
//
// THERE IS EXACTLY ONE THIRD CATEGORY, and it is listed in ALLOWED below rather
// than left to judgment:
//   FRAGMENTS -- half of a sentence that another element completes, where the
//     punctuation lives on the other half ("I've reviewed the" + the agreement's
//     name + "."; "How are you" + "feeling today?").
//   UNIT CAPTIONS -- the word under a figure that belongs to the number and is
//     read as part of it ("6 enrolled", "62% of roster", "3.4 avg mood"). These
//     are units, like mph. A period would be wrong and Title Case reads as a
//     heading the tile already has above the number.
//
// ⚠️ IT IS DELIBERATELY NARROW. It reads only strings short enough to be a
// label, and in src/ only the three places a label is actually written: a
// JSX text node, a `heading:` value, and a string inside a JSX expression in
// text position (which is how the buttons are written). It would rather miss a
// straggler than block a deploy over a caption. The exceptions below are the
// strings where a human decided the lowercase is right, each with its reason.
//
// IT ALSO COVERS THE EMAILS in infra/lambda/ (David asked, 2026-09-16). Their
// copy is template literals this cannot read as markup, so it looks for the two
// places an email carries a LABEL: the second argument of emailButton(), and
// any string ending in the house arrow, which is how a call to action is
// written here.
//
// ⛔ EMAIL SUBJECTS ARE DELIBERATELY NOT CHECKED. A subject is a headline, not
// a label -- it sits in an inbox among other people's sentences, and all three
// of ours are sentence case on purpose ("Your GlowPT week"). If that is ever
// meant to change it is a decision, not a straggler.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// AP, not Chicago: four letters or more is capitalised, three or fewer is not.
const SMALL = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of',
  'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs',
]);

// Strings that are lowercase ON PURPOSE: a FRAGMENT or a UNIT CAPTION, per the
// note above. Nothing else belongs in here -- anything that is simply a label
// gets Title Case, and anything that is a sentence gets its period.
const ALLOWED = new Set([
  'of roster',        // unit: reads as part of "62% of roster"
  'checked in',       // unit: "4 checked in", under the Active This Week tile
  'avg mood',         // unit: part of the number it trails
  'Signing up as',    // a sentence fragment introducing a value, not a label
  'Signed in as',     // its twin
  'How are you',      // the check-in question, split over two lines by <br/>
  'glowpt.app',       // an address, not words
  'A FranklinAI product · Philadelphia', // the footer byline reads as prose
  'Questions? Email', // a question plus a lead-in to the address
  // The consent checkbox reads as ONE sentence with the agreement's name
  // inside it: "I've reviewed the Business Associate Agreement." These two
  // are the half before the link, so they are prose, not labels.
  'I agree to the',
  'I’ve reviewed the',
]);

const WORD = /[A-Za-z][A-Za-z'’-]*/g;

// The email files carry no JSX, so their labels are found by shape instead:
// the label argument of emailButton(), and anything ending in the house arrow.
function emailLabels(src) {
  const found = [];
  for (const m of src.matchAll(/emailButton\([^,]+,\s*['`]([^'`\n]{3,45})['`]/g)) {
    found.push({ text: m[1], index: m.index });
  }
  for (const m of src.matchAll(/['`]([^'`\n]{3,45}→)['`]/g)) {
    found.push({ text: m[1], index: m.index });
  }
  return found;
}

function violations(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const seen = new Set();
  // JSX text nodes, the `heading:` values the legal copy is built from, and
  // strings inside a JSX EXPRESSION in text position -- which is how most
  // button labels are written here: {busy ? 'Saving…' : 'Create My Clinic →'}.
  // ⚠️ That last pattern was missing on the first cut and the very screen that
  // prompted this script had "Create my clinic →" on its button, in plain view.
  // A checker is only worth what it looks at.
  const patterns = [/>([A-Za-z][^<>{}\n]{2,45})</g, /heading:\s*['"]([^'"\n]{3,60})['"]/g];
  const expressions = [...src.matchAll(/>\s*\{([^<>]{0,300}?)\}\s*</g)].flatMap((m) =>
    [...m[1].matchAll(/'([^'\n]{3,45})'/g)].map((lit) => ({
      text: lit[1],
      index: m.index,
    })),
  );
  const emails = file.includes('infra/lambda') ? emailLabels(src) : [];
  for (const re of [...patterns, expressions, emails]) {
    const matches = Array.isArray(re) ? re : src.matchAll(re);
    for (const raw of matches) {
      const m = Array.isArray(re) ? [null, raw.text] : raw;
      if (Array.isArray(re)) m.index = raw.index;
      const text = m[1].trim();
      if (!text || ALLOWED.has(text)) continue;
      // Ends in punctuation -> it is a statement, and sentence case is correct.
      if (/[.?!:…]$/.test(text)) continue;
      const words = text.match(WORD) || [];
      if (words.length < 2) continue;
      const bad = words
        .slice(1)
        .filter((w) => /^[a-z]/.test(w) && !SMALL.has(w.toLowerCase()));
      if (!bad.length) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${line}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ line, text, bad });
    }
  }
  return out;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(path);
  }
  return files;
}

let found = 0;
for (const file of [...walk('src'), ...walk('infra/lambda')]) {
  for (const v of violations(file)) {
    found += 1;
    console.error(
      `${file}:${v.line}  "${v.text}"  -> lowercase where the rule wants Title Case: ${v.bad.join(', ')}`,
    );
  }
}

if (found) {
  console.error(
    `\ntitle case: ${found} label${found === 1 ? '' : 's'} not in Title Case.\n` +
      'Fix it, or if the lowercase is deliberate add the exact string to ALLOWED in this file with a reason.',
  );
  process.exit(1);
}
console.log('title case ok');
