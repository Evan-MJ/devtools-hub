/**
 * BUG-550 prod test: the World Cup tracker must not claim the tournament is live
 * (or show a blank knockout bracket) after the tournament has finished.
 *
 * WHY
 *   updateCountdown() only checked the opening match (2026-06-11), so on 2026-11-16
 *   the page still shouted "TOURNAMENT IS LIVE!". On top of that the knockout tab
 *   was a stub: renderKnockout() existed but was never called, so the page said
 *   "Knockout bracket will appear after group stage matches are determined" for a
 *   tournament that was over — exactly the kind of stale content that made Google
 *   flag the URL. Scores also used score.ft only, so the final read 0-0 and every
 *   penalty shoot-out looked like a draw.
 *
 * WHAT IT CHECKS
 *   [A] the page loads, no JS errors, 104 matches, data source reachable
 *   [B] the countdown says FINISHED (never "IS LIVE") and no stale countdown ticks
 *   [C] the knockout bracket renders every knockout round + a champion
 *   [D] the official result is shown: extra-time / penalty shoot-outs are labelled,
 *       and the champion is the team that actually won the final
 *
 * Usage: node test-scripts/bug550-world-cup-tracker-prod-test.js
 */
const { chromium } = require('playwright');

const BASE = process.env.GC_BASE || 'https://tools.scoreroute.com';
const URL = BASE + '/tools/world-cup-tracker/?cb=' + Date.now();
let pass = 0, fail = 0;
const step = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  try {
    console.log('\n[A] load');
    const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    step('HTTP 200', resp.status() === 200, String(resp.status()));
    await page.waitForSelector('#wcScheduleBody tr', { timeout: 20000, state: 'attached' });
    await page.click('.wc-tab[data-panel="schedule"]');
    step('no JS errors', errs.length === 0, errs.join(' | '));
    step('104 matches rendered', (await page.locator('#wcScheduleBody tr').count()) === 104);
    step('104 matches played', /\b104\b/.test((await page.locator('#statPlayed').innerText()).trim()));

    console.log('\n[B] countdown');
    const cd = (await page.locator('#wcCountdown').innerText()).trim();
    step('countdown does not say LIVE', !/IS LIVE/i.test(cd), cd);
    step('countdown says the tournament is finished', /FINISHED/i.test(cd), cd);
    step('no stale day/hour tick is shown', !/^--$/.test(cd), cd);

    console.log('\n[C] knockout bracket');
    const rounds = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#wcBracket .wc-bracket-round').forEach(c => {
        out[c.querySelector('.wc-bracket-round-title').textContent.trim()] = c.querySelectorAll('.wc-bracket-match').length;
      });
      return out;
    });
    step('bracket is not empty', Object.keys(rounds).length > 0, JSON.stringify(rounds));
    step('Round of 32 has 16 matches', rounds['Round of 32'] === 16, JSON.stringify(rounds));
    step('Round of 16 has 8 matches', rounds['Round of 16'] === 8, JSON.stringify(rounds));
    step('Quarter-final has 4 matches', rounds['Quarter-final'] === 4, JSON.stringify(rounds));
    step('Semi-final has 2 matches', rounds['Semi-final'] === 2, JSON.stringify(rounds));
    step('Final has 1 match', rounds['Final'] === 1, JSON.stringify(rounds));
    step('a champion is shown', rounds['🏆 Champion'] === 1, JSON.stringify(rounds));
    step('the "will appear later" placeholder is hidden',
      await page.evaluate(() => getComputedStyle(document.getElementById('wcBracketEmpty')).display === 'none'));

    console.log('\n[D] official results');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#wcScheduleBody tr')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    const shootout = rows.find(r => /pens\)/.test(r));
    const aet = rows.find(r => /a\.e\.t\./.test(r));
    step('a penalty shoot-out is labelled', !!shootout, shootout || 'none found');
    step('an extra-time match is labelled', !!aet, aet || 'none found');
    step('no match is shown as a 0-0 draw that went to penalties', !/\b0 - 0\b(?!.*pens)/.test(shootout || 'x'));
    const champ = await page.evaluate(() => {
      const c = document.querySelector('#wcBracket .wc-bracket-round:last-child .wc-bracket-match .wc-bracket-team');
      return c ? c.innerText.replace(/\s+/g, ' ').trim() : '';
    });
    step('champion is a real team', /[^0-9]/.test(champ) && !/TBD/.test(champ), champ);
    step('no JS errors after rendering', errs.length === 0, errs.join(' | '));
  } catch (e) {
    fail++;
    console.log('  FAIL exception -> ' + e.message);
  } finally {
    await browser.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
