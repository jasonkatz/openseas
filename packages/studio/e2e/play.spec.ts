import { expect, test } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

/**
 * `/play/<puzzle>` (ADR 0042 decision 11): the puzzle with nothing around it, on the numbers its
 * link carries, held to the server's checks, and asking nothing of the game's server. Every board
 * is played there by its own smoke; this file is about the page.
 */
test("a play page is the puzzle alone and asks nothing of the game's server", async ({ page }) => {
  const outside: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  page.on("request", (r) => {
    const url = new URL(r.url());
    // Fonts are the page's own look; anything else off this origin is a server being asked.
    if (url.origin !== origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) outside.push(r.url());
  });
  page.on("websocket", (ws) => outside.push(ws.url()));
  await page.goto("/play/cooling");
  await expect(page.getByTestId("play")).toBeVisible();
  // No way back into the studio, no bench, no round that goes through a server.
  await expect(page.getByTestId("bench")).toHaveCount(0);
  await expect(page.getByTestId("bench-toggle")).toHaveCount(0);
  await expect(page.getByTestId("start-recorded")).toHaveCount(0);
  await expect(page.locator("a[href='/']")).toHaveCount(0);
  await expect(page.getByTestId("play-tuned")).toHaveCount(0);

  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  expect(outside).toEqual([]);
});

test("a tuned link plays its numbers, lists them beside the shipped ones, and rates against its own thresholds", async ({ page }) => {
  const thresholds = JSON.stringify([
    { score: 0, rating: 2900 },
    { score: 1000000, rating: 3000 },
  ]);
  await page.goto(`/play/cooling?seed=play-1&seconds=30&c.maxMoves=2&pace=5&thresholds=${encodeURIComponent(thresholds)}`);
  await expect(page.getByTestId("play-tuned")).toContainText("4");
  await expect(page.getByTestId("hud-time")).toHaveText("0:30");

  await page.getByTestId("toggle-details").click();
  const changes = page.getByTestId("play-changes");
  await expect(changes.locator("[data-key='config.maxMoves']")).toContainText("2");
  await expect(changes.locator("[data-key='config.maxMoves']")).toContainText("shipped");
  await expect(changes.locator("[data-key='roundSeconds']")).toContainText("30");
  await expect(changes.locator("[data-key='paceSeconds']")).toContainText("5");
  await expect(changes.locator("[data-key='thresholds']")).toContainText("0 / 1000000");
  await expect(page.getByTestId("play-seed")).toContainText("play-1");
  await page.getByTestId("toggle-details").click();

  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  const dealt = await page.getByTestId("cooling-board").getAttribute("data-board");
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  // The move cap ends the round. The shipped thresholds would call a score this small the lowest
  // tier; the link's own put even nothing near the top.
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("result-tier")).not.toHaveAttribute("data-tier", "green");
  // The round replayed from its seed, and a replay that agrees says nothing.
  await expect(page.getByTestId("replay-mismatch")).toHaveCount(0);

  // Play again deals the link's seed again; a new seed lets it go, here and in the address bar.
  await page.getByTestId("restart").click();
  await expectViewMatchesState(page, "cooling");
  expect(await page.getByTestId("cooling-board").getAttribute("data-board")).toBe(dealt);
  await page.getByTestId("toggle-details").click();
  await page.getByTestId("play-new-seed").click();
  await expect(page.getByTestId("hud-panel")).toBeHidden();
  await expect(page).not.toHaveURL(/seed=/);
  await expect(page).toHaveURL(/c\.maxMoves=2/);
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-seed")).not.toContainText("play-1");
});

test("a link the current build would refuse says why and deals nothing", async ({ page }) => {
  await page.goto("/play/cooling?c.width=1&seconds=5&start=lab");
  const refused = page.getByTestId("play-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("config.width");
  await expect(refused).toContainText("roundSeconds");
  await expect(page.getByTestId("cooling-canvas")).toHaveCount(0);
  await expect(page.getByTestId("play-start")).toHaveCount(0);

  // A field the wire schema does not know is a refusal too: the server would strip it.
  await page.goto("/play/cooling?c.notAField=1");
  await expect(page.getByTestId("play-refused")).toContainText("config");
  // Thresholds a content file could not hold.
  await page.goto(`/play/cooling?thresholds=${encodeURIComponent(JSON.stringify([{ score: 9, rating: 2 }, { score: 3, rating: 1 }]))}`);
  await expect(page.getByTestId("play-refused")).toContainText("thresholds");
});

test("a play link that names no puzzle says so", async ({ page }) => {
  await page.goto("/play/nothing");
  await expect(page.getByTestId("play-unknown")).toBeVisible();
});

test("a ticked round's clock can be held and stepped from a script, with no control on screen", async ({ page }) => {
  await page.goto("/play/gunnery?seed=play-clock&start=lab&paused=1");
  await expect(page.getByTestId("gunnery-canvas")).toBeVisible();
  await expect(page.getByTestId("clock")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.openseasRoundClock?.paused)).toBe(true);
  // The first tick falls a tick into the round, so count from past it.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.openseasRoundClock!.step();
  });
  const at = await page.evaluate(() => window.openseasRoundClock!.tick);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.openseasRoundClock!.step();
  });
  expect(await page.evaluate(() => window.openseasRoundClock!.tick)).toBe(at! + 5);
});
