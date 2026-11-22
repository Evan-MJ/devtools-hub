#!/usr/bin/env node
'use strict';
// BUG-557 gate — an INDEX page's <title> must carry the words its own <h1> carries.
//
// WHY
// The 2026-11-16 review bot's [CONTENT QUALITY SCORES] block named 4 of the site's index pages
// with "Title missing 'Free' modifier present in H1 and meta description". The page it named most
// often was /tools/ — the site's #2 page. Measured on production 2026-11-17:
//
//   /tools/   <h1>    "All 375 Free Online Developer Tools"
//             <title> "All 375 Online Developer Tools by Category | DevTools Hub"   <-- "Free" gone
//
// The word did not disappear from the page. The SAME page's <meta name="description"> said
// "Browse all 375 free online developer tools in 11 categories…", the static fallback
// tools/index.html said "All Free Online Developer Tools by Category | DevTools Hub", and the .md
// mirror's heading said "All 375 Free Online Developer Tools". Only the served <title> lost it.
//
// ROOT CAUSE — two hand-written implementations of one page.
// /tools/ is built by functions/tools/[[catchall]].js as a complete inline HTML document, and it
// also exists as the static fallback tools/index.html (which Cloudflare serves for any path with no
// file). When the live tool count was injected into the Function's title, the word "Free" was
// dropped with it. Nothing asserted that the two implementations agree, so the drift sat there.
//
// THE RULE — the site's own convention, checked where it is written.
// Every index page publishes <title> = its own <h1> + a qualifier + "| DevTools Hub":
//   /               "DevTools Hub - 375 Free Online Developer Tools"                ⊇ h1
//   /about/         "About DevTools Hub: Free Online Developer Tools, No Signup"   ⊇ h1
//   /privacy/       "Privacy Policy | Subprocessor Disclosure | DevTools Hub"       ⊇ h1
//   /contact/       "Contact DevTools Hub - Report a Bug or Request a Tool"        ⊇ h1
//   /subprocessors/ "Subprocessors & Third-Party Services | DevTools Hub"           ⊇ h1
//   /whats-new/     "What's New - Latest Tools and Updates | DevTools Hub"          ⊇ h1
//   /tools/<cat>/   "Calculators - 39 Free Online Tools | DevTools Hub"             ⊇ h1
//   /tools/feedback/ "Feedback - Report a Bug or Suggest a Tool | DevTools Hub"     ⊇ h1
//   /tools/         …did NOT. It was the only index page whose title dropped a word from its
//                   own heading.
//
// That is the invariant: the <title> contains the <h1>. It is decidable from the served bytes, and
// it is the rule BUG-447 already enforces for the 12 CTR tool pages ("the title starts with the
// page's own <h1>"), extended to the index surface.
//
// WHAT IT IS NOT: it is not "the title must be <= N characters". The character budget is a proxy
// for Google's 600px title budget; this gate measures the thing the budget stands for (see
// bug557-index-title-prod-test.js, which measures the rendered pixel width in Chromium).
//
// ANTI-VACUITY
// The pre-fix title is fed to the same checker and it must go red. The revert is a string revert of
// the source; the gate REFUSES to run when the anchor does not match — a no-op revert is the
// greenest possible lie.
//
// Usage: node bug557-index-title-gate.js [--root <site tree>]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { mkdirSync, writeFileSync, symlinkSync, existsSync } = require('fs');
const { pathToFileURL } = require('url');

const ROOT = (() => {
  const i = process.argv.indexOf('--root');
  if (i > -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.resolve(__dirname, '..');
})();

let fails = 0;
const ok = (c, m, d) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (d ? ' — ' + String(d).slice(0, 220) : ''));
  if (!c) fails++;
};

// ------------------------------------------------------------------ text helpers
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };
const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
  }
  const v = ENTITIES[e.toLowerCase()];
  return v === undefined ? m : v;
});
const plain = (s) => decode(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const titleOf = (html) => plain((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
const h1Of = (html) => plain((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
const metaOf = (html, attr, val) => {
  const re = new RegExp('<meta[^>]*(?:' + attr + ')=["\']' + val + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re);
  return m ? decode(m[1]).trim() : '';
};
/** The rule, as a pure function so the anti-vacuity tier can feed it a broken pair. */
function titleCoversH1(html) {
  const t = titleOf(html), h = h1Of(html);
  if (!t) return { ok: false, why: 'no <title>' };
  if (!h) return { ok: false, why: 'no <h1>' };
  return { ok: t.toLowerCase().includes(h.toLowerCase()), why: t + '  ⊅  ' + h };
}

// ------------------------------------------------------------------ the tree
const MANIFEST = fs.readFileSync(path.join(ROOT, 'manifest.txt'), 'utf8');
const TOOL_COUNT = MANIFEST.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
const SRC = fs.readFileSync(path.join(ROOT, 'functions/tools/[[catchall]].js'), 'utf8');

const ASSETS = {
  async fetch(u) {
    const p = new URL(u).pathname;
    if (p === '/manifest.txt') return new Response(MANIFEST, { status: 200 });
    const f = path.join(ROOT, p.replace(/^\//, ''));
    if (existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f), { status: 200 });
    return new Response('not found', { status: 404 });
  },
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const PROBE = path.join(os.tmpdir(), 'bug557-probe');
mkdirSync(path.join(PROBE, 'functions', 'tools'), { recursive: true });
if (!existsSync(path.join(PROBE, 'libs'))) symlinkSync(path.join(ROOT, 'libs'), path.join(PROBE, 'libs'), 'dir');

async function renderTools(source, urlPath) {
  const file = path.join(PROBE, 'functions', 'tools', 'catchall-probe.mjs');
  writeFileSync(file, source);
  const m = await import(pathToFileURL(file).href + '?v=' + Math.random());
  const r = await m.onRequest({
    request: new Request('https://tools.scoreroute.com' + urlPath),
    env: { ASSETS, FEEDBACK_KV: { get: async () => null } },
    next: async () => new Response('ASSETS'),
    params: {},
  });
  return r.text();
}
async function renderModule(rel, urlPath) {
  const m = await import(pathToFileURL(path.join(ROOT, rel)).href);
  const r = await m.onRequest({
    request: new Request('https://tools.scoreroute.com' + urlPath),
    env: { ASSETS },
    next: async () => new Response('ASSETS'),
    params: {},
  });
  return r.text();
}

console.log('BUG-557 gate — root: ' + ROOT);

async function main() {
// ------------------------------------------------------------------ [A] /tools/ (real render)
const toolsHtml = await renderTools(SRC, '/tools/');
console.log('\n[A] /tools/ rendered by the real module');
{
  const t = titleOf(toolsHtml), h = h1Of(toolsHtml);
  ok(/\bFree\b/.test(t), '[A1] the served title carries "Free"', t);
  const c = titleCoversH1(toolsHtml);
  ok(c.ok, '[A2] the served title contains the served <h1>', c.why);
  ok(metaOf(toolsHtml, 'property', 'og:title') === t, '[A3] og:title === <title>', metaOf(toolsHtml, 'property', 'og:title'));
  ok(metaOf(toolsHtml, 'name', 'twitter:title') === t, '[A4] twitter:title === <title>', metaOf(toolsHtml, 'name', 'twitter:title'));
  const n = (t.match(/\b(\d+)\b/) || [])[1];
  ok(String(n) === String(TOOL_COUNT), '[A5] the count in the title is the live manifest count (' + n + ' vs ' + TOOL_COUNT + ')');
  const d = metaOf(toolsHtml, 'name', 'description');
  ok(/\bfree\b/i.test(d), '[A6] the meta description still says "free" (the title had lost it)', d.slice(0, 80));
}

// ------------------------------------------------------------------ [B] the other Function-built index pages
console.log('\n[B] the other index pages the Functions build');
for (const [rel, urlPath, label] of [
  ['functions/index.js', '/', 'the homepage'],
  ['functions/whats-new.js', '/whats-new/', '/whats-new/'],
]) {
  try {
    const html = await renderModule(rel, urlPath);
    const c = titleCoversH1(html);
    ok(c.ok, '[B] ' + label + ': the served title contains the served <h1>', c.why);
  } catch (e) {
    ok(false, '[B] ' + label + ' rendered', e && e.message);
  }
}

// ------------------------------------------------------------------ [C] one category hub = the hub template
console.log('\n[C] one category hub (all 11 share one template)');
{
  const html = await renderTools(SRC, '/tools/calculators/');
  const c = titleCoversH1(html);
  ok(c.ok, '[C1] the served title contains the served <h1>', c.why);
  ok(/\bFree\b/.test(titleOf(html)), '[C2] the served title carries "Free"', titleOf(html));
}

// ------------------------------------------------------------------ [D] the static index pages + the drift check
console.log('\n[D] the static index pages, and the two-implementations drift check');
for (const rel of ['about/index.html', 'privacy/index.html', 'contact/index.html', 'subprocessors/index.html', 'tools/index.html']) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const c = titleCoversH1(html);
  ok(c.ok, '[D] ' + rel + ': the title contains its own <h1>', c.why);
}
{
  // The drift that caused BUG-557: the Function's /tools/ and the static fallback tools/index.html
  // are two hand-written implementations of one page. They must agree on the wording; only the
  // Function's carries the live count (a static file cannot know it — BUG-300).
  const staticTitle = titleOf(fs.readFileSync(path.join(ROOT, 'tools/index.html'), 'utf8'));
  const fnTitle = titleOf(toolsHtml);
  // The Function's copy carries the live count; the static one carries none at all (a static file
  // cannot know it — BUG-300). Drop the count slot from the Function's title and the two must be
  // the same string, character for character.
  const strip = (s) => s.replace(/\s*\b\d{2,4}\b/, '').trim();
  ok(strip(fnTitle) === strip(staticTitle),
    '[D] /tools/ : the Function and the static fallback publish the SAME title (count aside)',
    fnTitle + '   VS   ' + staticTitle);
  ok(/\bFree\b/.test(staticTitle), '[D] /tools/index.html (the static fallback) carries "Free"', staticTitle);
}

// ------------------------------------------------------------------ [E] anti-vacuity
console.log('\n[E] anti-vacuity — the pre-fix title must make the same checker go red');
{
  // The pre-fix title is DERIVED from the title template that is in the tree right now: take the
  // template's own prefix and drop the keyword the page's <h1> carries ("Free"), which is exactly
  // the historical defect (the served title had lost "Free" while the h1 kept it). Deriving it
  // instead of hardcoding it is what keeps the tier runnable: a hardcoded anchor only matches the
  // tree it was written for, and the day the title template changes the tier stops running and
  // reports "could not run" instead of proving anything (that is how this tier went stale once).
  // New format: <title>Free Online Developer Tools by Category - ' + _totalCount + ' Tools | DevTools Hub</title>
  const tpl = SRC.match(/<title>([^<]*?)'\s*\+\s*_totalCount\s*\+\s*'[^<]*<\/title>/);
  const prefix = tpl ? tpl[1] : '';
  const prePrefix = prefix.replace(/\bFree\b/, '');        // the word the h1 still carried
  const PRE = "<title>" + prefix + "' + _totalCount + '";
  const POST = "<title>" + prePrefix + "' + _totalCount + '";
  const hits = SRC.split(PRE).length - 1;
  if (!prefix || prePrefix === prefix || hits < 1) {
    // No title template, nothing to derive from, or the anchor does not match: the tier cannot
    // run. That is NOT a pass — report it as a failure rather than a silent skip.
    ok(false, '[E0] the anti-vacuity tier could not run (no title template to derive from, or the ' +
      'anchor did not match)', 'prefix=' + JSON.stringify(prefix) + ' hits=' + hits);
  } else {
    const stripped = SRC.split(PRE).join(POST);
    const html = await renderTools(stripped, '/tools/');
    const c = titleCoversH1(html);
    ok(!c.ok, '[E1] the pre-fix title FAILS the same rule', c.why);
    ok(!/\bFree\b/.test(titleOf(html)), '[E2] the pre-fix title has no "Free" either', titleOf(html));
    ok(titleCoversH1(toolsHtml).ok, '[E3] and the fixed tree still passes it', titleCoversH1(toolsHtml).why);
  }
}

console.log('\n' + (fails ? 'FAIL: ' + fails + ' check(s) failed' : 'PASS: all checks green'));
process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('EXIT: ' + (e && e.stack || e)); process.exit(2); });
