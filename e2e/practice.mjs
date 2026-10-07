// Opens a practice swordfight from the tavern and plays for a bit (local AI brigand).
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:8787';
const out = (n) => new URL(`../screens/${n}.png`, import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tidebound.tips', JSON.stringify(['ashore','deck','sea','battle','sword'])); } catch {} });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.stack));
await page.goto(base);
await page.getByPlaceholder(/e\.g\./).fill('Prac' + Date.now().toString(36).slice(-4));
await page.getByRole('button', { name: /Come ashore/ }).click();
await page.waitForSelector('.topbar');
await page.evaluate(() => window.__tb_open('tavern'));
await page.getByRole('button', { name: 'Practice' }).click();
await page.getByText('Swordfight', { exact: false }).last().click();
await page.waitForSelector('.puzzle-host', { timeout: 8000 });
await page.mouse.click(300, 400);
for (let i = 0; i < 80; i++) { await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowLeft'][i % 4]); await page.keyboard.press('Space'); await page.waitForTimeout(140); }
await page.screenshot({ path: out('14-practice-swordfight') });
const hud = await page.locator('.puzzle-top').innerText();
console.log(hud.replace(/\n/g, ' | '));
console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'ok');
await browser.close();
