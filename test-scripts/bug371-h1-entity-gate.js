#!/usr/bin/env node
// BUG-371 gate — a heading ships the CHARACTER, not the entity's name.
//
// WHY
// The 2026-10-16 review bot's [CONTENT QUALITY SCORES] named three category pages
// (/tools/ai-language/, /tools/media/, /tools/code-testing/) with one note:
//
//   "H1 contains HTML entity &mdash; instead of a readable dash or space"
//
// The rendered <h1> was correct — a browser decodes `&mdash;` to "—". What is wrong is the SERVED
// BYTE: a text extractor that reads the markup (crawler, agent, the bot) gets the entity NAME, and
// on the category pages the same heading was published THREE different ways — `&mdash;` in the HTML
// <h1>, a plain `-` in the .md mirror H1, and a plain `-` in <title>. One heading, three strings.
//
// THE CLASS, enumerated from the tree (never from the finding — the finding names 3 of 13):
//   * 11 category pages — functions/tools/[[catchall]].js builds the <h1> from a template.
//   * 2 tool pages — image-to-pdf, subtitle-editor — authored static markup.
// `&amp;` / `&lt;` / `&gt;` / `&quot;` are STRUCTURAL escapes (there is no literal character that may
// stand for them in text) and are deliberately NOT in the set below. A `<select>`'s options and a
// `<script>` body are not text: both are blanked before the H1 is read.
//
// Usage: node bug371-h1-entity-gate.js [rootDir]
//   rootDir defaults to ../../devtools-hub. Pass a tree with the fix stripped (or re-inject
//   `&mdash;`) to prove the gate goes red — the gate must be shown red before it is believed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));
const failures = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return cond; };

// Named character references that HAVE a literal character (so the entity is never required).
const TYPOGRAPHIC = ['mdash', 'ndash', 'hellip', 'middot', 'bull', 'times', 'divide', 'copy', 'reg',
  'trade', 'laquo', 'raquo', 'ldquo', 'rdquo', 'lsquo', 'rsquo', 'nbsp', 'deg', 'plusmn', 'frac12'];

const strip = (s) => s
  .replace(/<(script|style|noscript|template|textarea|select)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ');

// All h1-h6, not just h1: a heading is what libs/html-md.js turns into a markdown `#` heading, and
// the review note ("H1 contains HTML entity") is the instance of that class. A `<script>`-built
// heading is blanked with its body — at runtime the parser decodes the entity, so the RENDERED
// heading is already the character; only a heading in the SERVED DOM is this defect (verified:
// ssl-checker / pdf-form-filler build `<h3>&mdash;…` in JS strings and render clean).
function headingsOf(html) {
  return [...strip(html).matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => [m[1], m[2]]);
}

// ── Tier A: the 347 authored tool pages ────────────────────────────────────────
const toolDirs = fs.readdirSync(path.join(ROOT, 'tools'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);
let pages = 0; let hcount = 0; const dirty = [];
for (const slug of toolDirs) {
  const f = path.join(ROOT, 'tools', slug, 'index.html');
  if (!fs.existsSync(f)) continue;
  pages++;
  for (const [tag, text] of headingsOf(fs.readFileSync(f, 'utf8'))) {
    hcount++;
    const hit = TYPOGRAPHIC.find((e) => new RegExp('&' + e + ';', 'i').test(text));
    if (hit) dirty.push(slug + ': &' + hit + '; in <' + tag + '>');
  }
}
ok(pages >= 340, 'scanned ' + pages + ' tool pages (expected >=340 — a tree this gate cannot read is not a pass)');
ok(hcount >= 340, 'found ' + hcount + ' headings h1-h6 (expected >=340)');
ok(dirty.length === 0, 'no tool-page heading (h1-h6) ships a typographic named entity — got: ' + dirty.join(' | '));

// ── Tier B: the generated category page (11 pages, one template) ───────────────
// Read the real template; do not re-derive it.
//
// BUG-550 widened this tier. It used to pin ONE character (`—`) for the visible <h1> and the
// .md mirror <h1> — which fixed BUG-371's entity-vs-character bug but left the <title> as the
// third spelling of the same heading ("one heading, three strings", only two-thirds fixed). The
// 2026-11-16 review bot's [CONTENT QUALITY SCORES] then named the remaining disagreement on
// /tools/code-testing/, /tools/formatters/ and /tools/ai-language/ ("Title uses hyphen, H1 uses
// em dash"). The durable rule is not "which character" but "ONE character, everywhere": the
// <title>, the visible <h1>, the .md mirror's <h1> and the homepage's <h1> must all use the same
// separator for the "Name - N Free Online ... Tools" shape. That is decidable from the source and
// it cannot rot into "half the site was changed" the way a pinned character can.
const fn = fs.readFileSync(path.join(ROOT, 'functions/tools/[[catchall]].js'), 'utf8');
const homeFn = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const htmlH1 = fn.match(/<h1[^>]*>' \+ esc\(displayName\) \+ ' ([^']+) ' \+ total \+ ' Free Online Tools/);
const mdH1 = fn.match(/let md = '# ' \+ displayName \+ ' ([^']+) ' \+ total \+ ' Free Online Tools/);
const titleT = fn.match(/<title>' \+ esc\(displayName\) \+ ' ([^']+) ' \+ total \+ ' Free Online Tools/);
const homeH1 = homeFn.match(/<h1><a href="\/">DevTools Hub ([^']+?) ' \+ totalCount \+ ' Free Online Developer Tools/);
ok(!!htmlH1, 'category HTML <h1> template found in functions/tools/[[catchall]].js');
ok(!!mdH1, 'category .md  <h1> template found in categoryToMarkdown()');
ok(!!titleT, 'category <title> template found in functions/tools/[[catchall]].js');
ok(!!homeH1, 'homepage <h1> template found in functions/index.js');

// The rule, as a pure function so the anti-vacuity tier can feed it a deliberately broken set.
function separatorFailures(seps) {
  const names = ['<title>', 'visible <h1>', '.md <h1>', 'homepage <h1>'];
  const vals = seps.map((s) => (s == null ? null : s.trim()));
  const out = [];
  if (vals.some((v) => v === null)) { out.push('a separator could not be read from the source'); return out; }
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[0]) out.push(names[i] + ' uses "' + vals[i] + '" but ' + names[0] + ' uses "' + vals[0] + '"');
  }
  for (let i = 0; i < vals.length; i++) {
    if (/&[a-z]+;|&#\d+;/.test(vals[i])) out.push(names[i] + ' separator ships an entity name instead of the character — got "' + vals[i] + '"');
  }
  return out;
}

if (htmlH1 && mdH1 && titleT && homeH1) {
  const seps = [titleT[1], htmlH1[1], mdH1[1], homeH1[1]];
  const bad = separatorFailures(seps);
  ok(bad.length === 0,
    'the category <title>, its visible <h1>, its .md mirror <h1> and the homepage <h1> all use the SAME separator (got: ' +
    seps.map((s) => JSON.stringify(s.trim())).join(' / ') + ')' + (bad.length ? ' -> ' + bad.join(' | ') : ''));

  // Anti-vacuity: the rule must be able to go red. Feed it the exact disagreement the review bot
  // reported (title hyphen, h1 em dash) and require the same checker to report it.
  const broken = separatorFailures([titleT[1], ' \u2014 ', mdH1[1], homeH1[1]]);
  ok(broken.length > 0, 'anti-vacuity: a <title>/<h1> separator disagreement is detected');
  ok(broken.some((f) => /visible <h1> uses/.test(f)), 'anti-vacuity: the disagreement is named (' + broken.join(' | ') + ')');
}

// ── Tier B2: the stale hardcoded tool count, same generated block ──────────────
// AGENTS.md: "Do not hardcode a tool count ... write 'hundreds of browser-based utilities'."
const aboutMd = fn.match(/DevTools Hub is a free collection of ([^\n]+?) browser-based developer tools\./);
ok(!!aboutMd, 'category .md "About DevTools Hub" sentence found');
if (aboutMd) ok(!/\d/.test(aboutMd[1]), 'category .md about-block hardcodes no tool count — got "' + aboutMd[1] + '"');

// ── report ─────────────────────────────────────────────────────────────────────
console.log('BUG-371 heading-entity gate — ' + pages + ' tool pages, ' + hcount + ' headings (h1-h6), category template + .md about-block');
if (failures.length) { for (const f of failures) console.log('  ✗ ' + f); console.log('\n' + (checks - failures.length) + '/' + checks + ' failed'); process.exit(1); }
console.log('  ✓ ' + checks + '/' + checks + ' checks passed');
process.exit(0);
