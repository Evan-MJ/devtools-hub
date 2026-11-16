/**
 * Whole-site JS error scan: load every tool page on the live site and report
 * any console error, page error or failed request.
 *
 * This is the scan that caught the HTML Playground's CSP violation (1/375)
 * before BUG-552 was fixed, and it is the regression net for it.
 *
 * Usage: node test-scripts/site-js-error-scan.js [baseUrl]
 *        (the file name deliberately does NOT end in -prod-test: it takes
 *         several minutes and belongs to the manual sweep, not to CI)
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.SCAN_BASE || 'https://tools.scoreroute.com';

(async () => {
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => /\/tools\/[^/]+\/$/.test(u));

  console.log(`scanning ${urls.length} tool pages on ${BASE}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const bad = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 160)); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('requestfailed', (r) => {
      const err = r.failure() ? r.failure().errorText : '';
      if (!/ERR_ABORTED/.test(err)) problems.push('requestfailed: ' + r.url().slice(0, 120) + ' ' + err);
    });

    try {
      await page.goto(url + '?cb=' + Date.now(), { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(900);
    } catch (e) {
      problems.push('navigation: ' + String(e.message).slice(0, 120));
    }
    await page.close();

    if (problems.length) {
      bad.push({ url, problems });
      console.log('FAIL ' + url.replace(BASE, ''));
      for (const p of problems.slice(0, 3)) console.log('      ' + p);
    }
    if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${urls.length}`);
  }

  await browser.close();
  console.log(`\n${bad.length} of ${urls.length} pages reported a problem`);
  process.exit(bad.length ? 1 : 0);
})();
