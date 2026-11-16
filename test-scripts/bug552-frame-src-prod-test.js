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
 *   The CSP that production actually sends is the one in functions/_middleware.js
 *   (CSP_DEFAULT / CSP_UNSAFE_EVAL), not the one in `_headers` - `_headers` only
 *   applies to statically served files, while every page here is served by the
 *   Pages Functions catchall. So the fix had to go into the middleware.
 *
 * WHAT IT CHECKS
 *   [A] the served CSP allows data: frames
 *   [B] the page loads with no CSP violation
 *   [C] typing code + clicking Run renders it inside the preview iframe
 *       (the frame must NOT be a chrome-error:// frame, and its text must be the
 *        code that was typed)
 *
 * NOTE on how the frame is inspected: the preview iframe is `sandbox="allow-scripts"`
 *   WITHOUT `allow-same-origin`, so it is a cross-origin (opaque) document - the page's
 *   own `iframe.contentDocument` is null even for a perfectly working frame. Playwright's
 *   frame API is the correct way to look inside it.
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

async function checkTool(browser, slug, opts) {
  const page = await browser.newPage();
  const csp = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|violates the following/i.test(t)) csp.push(t.slice(0, 140));
  });

  await page.goto(`${BASE}/tools/${slug}/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  step(`${slug}: the page loads with no CSP violation`, csp.length === 0, csp[0]);

  if (opts.fill) await page.fill(opts.fill.sel, opts.fill.value).catch(() => {});
  await page.click(opts.runButton, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const frames = page.frames();
  const preview = frames.find((f) => f !== page.mainFrame());
  const url = preview ? preview.url() : '';
  const isError = url.startsWith('chrome-error://');
  let text = '';
  if (preview && !isError) {
    text = await preview.evaluate(() => (document.body ? document.body.innerText || '' : '')).catch(() => '');
  }

  step(`${slug}: the preview frame is not an error frame (it was not blocked)`, preview !== undefined && !isError, url.slice(0, 60));
  step(`${slug}: the preview shows the rendered code`, text.includes(opts.expect), JSON.stringify(text.slice(0, 80)));

  await page.close();
  return csp.length;
}

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
  await checkTool(browser, 'html-playground', {
    fill: { sel: '#hp-html', value: '<h1 id="t">preview works</h1>' },
    runButton: 'button:has-text("Run")',
    expect: 'preview works'
  });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
