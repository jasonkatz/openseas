// Screenshots each puzzle renderer from the local dev harness after a burst of inputs.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const keys = { bilging: ['ArrowRight', 'Space', 'ArrowDown', 'Space', 'ArrowLeft', 'Space'], sailing: ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowRight', 'Space'], carpentry: ['1', 'r', 'ArrowRight', 'ArrowDown', 'Space', '2', 'f', 'Space'], gunnery: ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowRight', 'ArrowRight', 'Space', 'c'], navigation: ['Space', 'ArrowRight', 'Space', 'ArrowUp', 'Space', 'q'], swordfight: ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowRight', 'Space', 'z', 'Space'] };
for (const id of Object.keys(keys)) {
  await page.goto(`${base}/?puzzle=${id}&seed=11`);
  await page.waitForSelector('canvas', { timeout: 10000 });
  await page.mouse.click(600, 400);
  await page.waitForTimeout(800);
  for (let i = 0; i < 30; i++) { await page.keyboard.press(keys[id][i % keys[id].length]); await page.waitForTimeout(90); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL(`../screens/puzzle-${id}.png`, import.meta.url).pathname });
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ok');
await browser.close();
