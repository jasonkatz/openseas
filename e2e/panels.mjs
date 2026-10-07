// Screenshots the login screen and each island building panel.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:8787';
const out = (n) => new URL(`../screens/${n}.png`, import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tidebound.tips', JSON.stringify(['ashore','deck','sea','battle','sword'])); } catch {} });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base);
await page.getByPlaceholder(/e\.g\./).fill('Panels' + Date.now().toString(36).slice(-4));
await page.screenshot({ path: out('00-login') });
await page.getByRole('button', { name: /Come ashore/ }).click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(600);
for (const k of ['tavern', 'shipwright', 'market', 'bank', 'palace']) {
  await page.evaluate((k) => window.__tb_open(k), k);
  await page.waitForSelector('.modal-backdrop');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out(`panel-${k}`) });
  if (k === 'tavern') {
    for (const tab of ['Leaderboard', 'Practice']) { await page.getByRole('button', { name: tab }).click().catch(() => {}); await page.waitForTimeout(300); await page.screenshot({ path: out(`panel-tavern-${tab.toLowerCase()}`) }); }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'ok');
await browser.close();
