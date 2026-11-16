/**
 * Prod test for the three "the feature never worked in production" fixes.
 *
 *   1. /tools/api-tester/   the REST API Tester showed "(empty response)" for
 *                           every request: the relay Worker decoded the body
 *                           twice and the second decode blanked it.
 *   2. /tools/space-keeper/ all four access methods were refused by the site's
 *                           own CSP, so the tool could not reach a Space. It now
 *                           goes through the server-side relay.
 *   3. /tools/html-to-image/ the "Load URL" tab pointed the preview iframe at an
 *                           external page, which the CSP blocks (and which the
 *                           page itself blocks with X-Frame-Options). It now
 *                           fetches the HTML through the relay.
 *
 * Usage: node test-scripts/live-fetch-tools-prod-test.js
 */
const { chromium } = require('playwright');

const BASE = process.env.LIVE_BASE || 'https://tools.scoreroute.com';

let pass = 0, fail = 0;
const step = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // ---- [1] the API Tester gets a body back ------------------------------------
  console.log('[1] /tools/api-tester/ shows the response body');
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/tools/api-tester/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.fill('#atUrl', 'https://example.com');
    await page.click('#atSendBtn');
    await page.waitForFunction(
      () => { const el = document.querySelector('#atResponseBody'); return el && el.textContent.trim() && el.textContent.trim() !== '(empty response)'; },
      null, { timeout: 25000 }
    ).catch(() => {});
    const body = await page.evaluate(() => (document.querySelector('#atResponseBody') || {}).textContent || '');
    step('the response body is not "(empty response)"', body.trim() && body.trim() !== '(empty response)', JSON.stringify(body.slice(0, 70)));
    step('the body carries the fetched page', /doctype|example/i.test(body), JSON.stringify(body.slice(0, 70)));
    await page.close();
  }

  // ---- [2] Space Keeper reaches the Space -------------------------------------
  console.log('[2] /tools/space-keeper/ visits a Space');
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/tools/space-keeper/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.fill('#space-url', 'https://enzostvs-deepsite.hf.space');
    await page.click('#add-btn');
    // Wait for the visit to finish. The card starts as "○ Pending"; note that
    // body text also contains the inline script source, so the wait must key
    // on the status badge, not on the word "Method".
    await page.waitForFunction(
      () => { const el = document.querySelector('.space-status'); return el && /(Online|Offline)/.test(el.textContent); },
      null, { timeout: 30000 }
    ).catch(() => {});
    const card = await page.evaluate(() => {
      const el = document.querySelector('.space-card');
      if (!el) return null;
      return {
        meta: (el.querySelector('.space-meta') || {}).textContent || '',
        status: (el.querySelector('.space-status') || {}).textContent.trim() || ''
      };
    });
    step('the space card records the visit', !!card, JSON.stringify(card));
    step('the visit reports a method (not "None")', !!card && !/Method:\s*None/.test(card.meta), JSON.stringify(card && card.meta));
    step('the space is reported online', !!card && /Online/.test(card.status), JSON.stringify(card && card.status));
    step('no method is called "Iframe Preload" any more', !!card && !/Iframe/.test(card.meta), JSON.stringify(card && card.meta));
    await page.close();
  }

  // ---- [3] HTML to Image loads a URL ------------------------------------------
  console.log('[3] /tools/html-to-image/ loads a URL');
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/tools/html-to-image/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.click('.h2i-tab[data-pane="url"]');
    await page.waitForTimeout(300);
    await page.fill('#urlInput', 'https://example.com');
    await page.click('#loadUrlBtn');
    await page.waitForFunction(
      () => (document.querySelector('#htmlInput') || {}).value && /doctype/i.test(document.querySelector('#htmlInput').value),
      null, { timeout: 25000 }
    ).catch(() => {});
    const html = await page.evaluate(() => (document.querySelector('#htmlInput') || {}).value || '');
    step('the fetched HTML lands in the editor', /doctype/i.test(html), JSON.stringify(html.slice(0, 70)));
    const preview = await page.evaluate(() => {
      const doc = document.querySelector('#previewFrame').contentDocument;
      return doc && doc.body ? doc.body.textContent.trim().slice(0, 60) : '';
    });
    step('the preview shows the fetched page', /example/i.test(preview), JSON.stringify(preview));
    await page.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
