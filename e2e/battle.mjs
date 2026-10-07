import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tidebound.tips', JSON.stringify(['ashore','deck','sea','battle','sword'])); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.stack));
await page.goto('http://localhost:8787');
await page.getByPlaceholder(/e\.g\./).fill('Dbg' + Date.now().toString(36).slice(-4));
await page.getByRole('button', { name: /Come ashore/ }).click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(500);
await page.evaluate(() => window.__tb_open('dock'));
await page.getByRole('button', { name: /^Board/ }).first().click();
await page.waitForSelector('.station-grid');
await page.getByRole('button', { name: /Set sail/ }).click();
await page.getByRole('button', { name: 'Gullrock' }).click();
await page.getByRole('button', { name: /Anchors aweigh/ }).click();
const state = () => page.evaluate(() => { const s = window.__tb_store.getState(); return { battle: s.battle && { phase: s.battle.phase, turn: s.battle.turn }, sf: s.swordfight && { phase: s.swordfight.phase, n: s.swordfight.players.length }, end: !!s.battleEnd, puzzle: !!s.puzzle, room: s.room?.kind }; });
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000);
  const st = await state();
  console.log(i, JSON.stringify(st));
  if (st.battle?.phase === 'orders') { await page.getByRole('button', { name: /Ready/ }).click({ timeout: 1000 }).catch(() => {}); }
  if (st.sf) { await page.waitForTimeout(1500); await page.screenshot({ path: '/home/user/puzzle-rebuild/screens/10-swordfight.png' }); for (let k = 0; k < 40; k++) { await page.keyboard.press(k % 3 ? 'ArrowLeft' : 'ArrowUp'); await page.keyboard.press('Space'); await page.waitForTimeout(120); } await page.screenshot({ path: '/home/user/puzzle-rebuild/screens/11-swordfight-played.png' }); break; }
}
await browser.close();
