// Two pirates duel at the tavern; then one duels an islander.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:8787';
const out = (n) => new URL(`../screens/${n}.png`, import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errs = [];
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('tidebound.tips', JSON.stringify(['ashore','deck','sea','battle','sword'])); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`[${name}] ${e.stack}`));
  await page.goto(base);
  await page.getByPlaceholder(/e\.g\./).fill(name);
  await page.getByRole('button', { name: /Come ashore/ }).click();
  await page.waitForSelector('.topbar');
  return page;
};
const st = Date.now().toString(36).slice(-4);
const a = await mk('Duela' + st), b = await mk('Duelb' + st);
await a.waitForTimeout(800);
await a.evaluate(() => window.__tb_open('tavern'));
await a.getByRole('button', { name: 'Duel' }).click();
await a.waitForTimeout(300);
await a.screenshot({ path: out('15-duel-tab') });
await a.locator('.list-item', { hasText: 'Duelb' + st }).getByRole('button', { name: 'Challenge' }).click();
await b.waitForSelector('text=challenges you', { timeout: 8000 });
await b.screenshot({ path: out('16-duel-invite') });
await b.getByRole('button', { name: /Draw steel/ }).click();
await a.waitForSelector('text=Boarding action', { timeout: 8000 });
await b.waitForSelector('text=Boarding action', { timeout: 8000 });
await a.waitForTimeout(1000);
for (let i = 0; i < 30; i++) { await a.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowUp'); await a.keyboard.press('Space'); await b.keyboard.press('ArrowRight'); await b.keyboard.press('Space'); await a.waitForTimeout(120); }
await a.screenshot({ path: out('17-duel-fight') });
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'ok');
await browser.close();
