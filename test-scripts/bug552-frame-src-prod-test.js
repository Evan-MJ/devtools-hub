/**
 * BUG-552 prod test: the HTML Playground's live preview must actually render.
 *
 * WHY
 *   The playground renders the user's code in `<iframe src="data:text/html,...">`.
 *   The site's Content-Security-Policy had no `frame-src`, so `default-src 'self'`
 *   applied to frames and the browser BLOCKED the data: URL:
 *     "Framing '' violates the following Content Security Policy directive:
 *      \"default-src 'self'\". The request has been blocked."
 *   The preview frame therefore never got a document - the tool's core feature was
 *   dead in production while the page itself looked fine.
 *
 * WHAT IT CHECKS
 *   [A] the served CSP allows data: frames (both tools that use a data: preview)
 *   [B] the page loads with no CSP violation
 *   [C] typing code + clicking Run renders it inside the preview iframe
 *
 * Usage: node test-scripts/bug552-frame-src-prod-test.js
 */
const { chromium } = require('playwright');

const BASE = process.env.FRAME_BASE || 'https://tools.scoreroute.com';

let pass = 0, fail = 0;
const step = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  console.log('[BUG-552] the live preview iframe must not be blocked by the CSP');

  // ---- [A] the served CSP allows data: frames --------------------------------
  for (const slug of ['html-playground', 'online-code-runner']) {
    const res = await fetch(`${BASE}/tools/${slug}/?cb=${Date.now()}`);
    const csp = res.headers.get('content-security-policy') || '';
    step(`/${slug}/ serves a CSP with frame-src that allows data:`, /frame-src[^;]*\bdata:/.test(csp), csp.slice(0, 90));
  }

  // ---- [B] + [C] the playground preview really renders -------------------------
  const page = await browser.newPage();
  const csp = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|violates the following/i.test(t)) csp.push(t.slice(0, 140));
  });
  await page.goto(`${BASE}/tools/html-playground/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  step('the page loads with no CSP violation', csp.length === 0, csp[0]);

  await page.fill('#hp-html', '<h1 id="t">preview works</h1>');
  await page.click('button:has-text("Run")', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const frame = await page.evaluate(() => {
    const f = document.getElementById('hp-preview');
    if (!f) return { found: false };
    const doc = f.contentDocument;
    return { found: true, hasDoc: !!doc, text: doc && doc.body ? (doc.body.innerText || '').trim().slice(0, 120) : '' };
  });
  step('the preview frame exists', frame.found === true, JSON.stringify(frame));
  step('the preview frame got a document (the iframe was not blocked)', frame.hasDoc === true, JSON.stringify(frame));
  step('the preview shows the rendered code', (frame.text || '').includes('preview works'), JSON.stringify(frame.text));
  await page.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
