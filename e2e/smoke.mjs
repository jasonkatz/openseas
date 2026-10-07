// End-to-end smoke: two pirates log in, walk, chat, board a navy sloop, work a station,
// set sail, and (if a brigand appears) fight. Screenshots land in ./screens.
// Usage: node e2e/smoke.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8787';
mkdirSync('screens', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
const errors = [];
const shot = async (page, name) => page.screenshot({ path: `screens/${name}.png` });
const mkPage = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
  await page.goto(base);
  await page.getByPlaceholder(/e\.g\./).fill(name);
  await page.getByRole('button', { name: /Come ashore/ }).click();
  await page.waitForSelector('.topbar', { timeout: 15000 });
  return page;
};

const stamp = Date.now().toString(36).slice(-4);
const a = await mkPage(`Marla${stamp}`);
const b = await mkPage(`Finn${stamp}`);
await a.waitForTimeout(1200);
await shot(a, '01-island');

// walk + chat
await a.keyboard.down('d'); await a.waitForTimeout(600); await a.keyboard.up('d');
await a.keyboard.press('Enter');
await a.keyboard.type('Ahoy from the smoke test!');
await a.keyboard.press('Enter');
await b.waitForTimeout(800);
await shot(b, '02-island-other-sees-chat');

// open dock and board the first navy sloop
const openDock = async (page) => {
  await page.evaluate(() => { window.__tb_open?.('dock'); });
  const ok = await page.waitForSelector('.modal-backdrop', { timeout: 3000 }).then(() => true).catch(() => false);
  return ok;
};
if (!(await openDock(a))) {
  // Fallback: walk to the dock door with the keyboard.
  await a.keyboard.down('s'); await a.waitForTimeout(500); await a.keyboard.up('s');
  await a.keyboard.press('e');
  await a.waitForSelector('.modal-backdrop', { timeout: 5000 });
}
await shot(a, '03-dock');
await a.getByRole('button', { name: /^Board/ }).first().click();
await a.waitForSelector('.station-grid', { timeout: 8000 });
await a.waitForTimeout(800);
await shot(a, '04-ship-deck');

// b boards the same ship
if (!(await openDock(b))) { await b.keyboard.down('s'); await b.waitForTimeout(500); await b.keyboard.up('s'); await b.keyboard.press('e'); await b.waitForSelector('.modal-backdrop', { timeout: 5000 }); }
await b.getByRole('button', { name: /^Board/ }).first().click();
await b.waitForSelector('.station-grid', { timeout: 8000 });

// a (captain) sets sail; b takes the bilge
await a.getByRole('button', { name: /Set sail/ }).click();
await a.waitForSelector('canvas[style*="pointer"]', { timeout: 5000 });
await a.getByRole('button', { name: 'Gullrock' }).click();
await a.getByRole('button', { name: /Anchors aweigh/ }).click();
await a.waitForTimeout(600);
await shot(a, '05-set-sail');
await b.locator('.station', { hasText: 'Bilge' }).click();
await b.waitForSelector('.puzzle-host', { timeout: 8000 });
await b.waitForTimeout(1500);
await shot(b, '06-bilging');
// play a bit
for (let i = 0; i < 25; i++) { await b.keyboard.press(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i % 4]); await b.keyboard.press('Space'); await b.waitForTimeout(60); }
await shot(b, '07-bilging-played');
await a.locator('.station', { hasText: 'Sails' }).click();
await a.waitForSelector('.puzzle-host', { timeout: 8000 });
for (let i = 0; i < 20; i++) { await a.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await a.keyboard.press('Space'); await a.waitForTimeout(80); }
await shot(a, '08-sailing');

// wait for a battle for up to 60s
const battle = await a.waitForSelector('text=Sea battle', { timeout: 90000 }).then(() => true).catch(() => false);
if (battle) {
  await a.waitForTimeout(1500);
  await shot(a, '09-battle');
  // captain: fire & grapple a few turns
  for (let turn = 0; turn < 6; turn++) {
    const ready = a.getByRole('button', { name: /Ready/ });
    if (await ready.count()) {
      const tok = a.locator('.seg .token').first();
      if (await tok.count()) await tok.click();
      const port = a.locator('.shotbtn').first();
      if (await port.count()) await port.click();
      const grap = a.getByText(/Grapple/).first();
      if (await grap.count()) await grap.click().catch(() => {});
      await ready.click().catch(() => {});
    }
    const sf = await a.waitForSelector('text=Boarding action', { timeout: 12000 }).then(() => true).catch(() => false);
    if (sf) { await a.waitForTimeout(1500); await shot(a, '10-swordfight'); for (let i = 0; i < 30; i++) { await a.keyboard.press(i % 3 ? 'ArrowLeft' : 'ArrowUp'); await a.keyboard.press('Space'); await a.waitForTimeout(150); } await shot(a, '11-swordfight-played'); break; }
    await a.waitForTimeout(6000);
  }
  await shot(a, '12-battle-later');
} else {
  console.log('no battle within the window (encounters are random)');
}
await shot(b, '13-b-final');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
