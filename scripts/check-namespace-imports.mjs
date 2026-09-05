// Fail the build if a screen calls something a module does not export.
//
// ⚠️ WHY THIS EXISTS. The screens use `import * as api from '../lib/api'`. A
// namespace import resolves at RUNTIME, so `api.invitePatient(...)` against a
// module with no such export is `undefined` and throws only when a user clicks
// the button. The bundler does not care and the build passes.
//
// On 2026-09-05 a scripted edit deleted six exports from src/lib/api.js by
// accident (provisionClinic, joinClinic, getStaffInvite, acceptStaffInvite,
// invitePatient, acceptPatientInvite: the onboard flow, both invite flows and
// the re-attach safety net). The build was clean and it shipped to production.
//
// This runs as `prebuild`, so it fires on every local build AND on every
// Netlify deploy, rather than being one more check nobody remembers to run.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const SRC = 'src';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') || p.endsWith('.jsx') ? [p] : [];
  });
}

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  // `async` and `function*` both sit between `export` and the name.
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const problems = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  // import * as <alias> from '<relative path>'
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const [, alias, rel] = m;
    let target = resolve(dirname(file), rel);
    const candidates = [target, `${target}.js`, `${target}.jsx`, join(target, 'index.js')];
    const found = candidates.find((c) => { try { return statSync(c).isFile(); } catch { return false; } });
    if (!found) continue; // not a local module we can check
    const available = exportsOf(found);
    const used = new Set([...src.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map((u) => u[1]));
    for (const name of used) {
      if (!available.has(name)) problems.push(`${file}: ${alias}.${name} is not exported by ${rel}`);
    }
  }
}

// Second guard, same family: an identifier that does not exist. `slugEdited`
// survived a control's removal on 2026-09-05 inside a JSX handler, so it was a
// ReferenceError on first keystroke and the build was green. eslint's no-undef
// catches exactly that. Only THAT rule is enforced here: src/ carries 15 other
// lint findings (react-hooks style) that are not runtime faults, and failing
// the build on those would be a different, larger decision.
try {
  const { execFileSync } = await import('node:child_process');
  let out = '';
  try {
    out = execFileSync('npx', ['eslint', SRC, '-f', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    out = e.stdout || ''; // eslint exits non-zero when it reports anything
  }
  if (out.trim()) {
    for (const file of JSON.parse(out)) {
      for (const m of file.messages) {
        if (m.ruleId === 'no-undef') {
          problems.push(`${file.filePath.split('/glowpt/').pop()}:${m.line}: ${m.message}`);
        }
      }
    }
  }
} catch {
  // eslint missing or unrunnable: the namespace check above still stands.
}

if (problems.length) {
  console.error('\nThings that would fail at RUNTIME but not at build time:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nThese fail at runtime, not at build time. Fix before shipping.\n');
  process.exit(1);
}
console.log(`namespace imports ok (${walk(SRC).length} files checked)`);
