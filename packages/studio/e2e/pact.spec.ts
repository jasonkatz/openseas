import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The board's layout in units from its corner, as `PACT_LAYOUT` in boards/src/pact/renderer.ts lays it out. */
const HAND_ROWS = [9.9, 11.8];
const CARD_PITCH = 1.33;
const BID_ROWS = [3.25, 4.45, 5.65];
const BID_PITCH = 1.15;
const BUTTON_Y = 13.55;

/** Wait for the board to settle on the player's bid or card, or between hands. */
async function waitFor(page: Page): Promise<string> {
  const canvas = page.getByTestId("pact-canvas");
  await expect(canvas).toHaveAttribute("data-phase", /^(bid|play|over|finished)$/, { timeout: 20_000 });
  await expectViewMatchesState(page, "pact");
  return (await canvas.getAttribute("data-phase")) ?? "";
}

/** Cards in the player's hand, from the board's view: `hand:tricks:phase|cards|...`. */
async function handSize(page: Page): Promise<number> {
  const view = (await page.getByTestId("pact-board").getAttribute("data-board")) ?? "";
  return (view.split("|")[1] ?? "").length / 2;
}

async function tapUnit(page: Page, x: number, y: number): Promise<void> {
  const { ox, oy, cell } = await boardGeom(page, "pact");
  await page.mouse.click(ox + x * cell, oy + y * cell);
}

/** Tap the k-th card of a hand of n as the board lays it out: two rows, the first holding the larger half. */
async function tapCard(page: Page, k: number, n: number): Promise<void> {
  const first = Math.ceil(n / 2);
  const row = k < first ? 0 : 1;
  const inRow = row === 0 ? first : n - first;
  const i = row === 0 ? k : k - first;
  await tapUnit(page, 5 + (i - (inRow - 1) / 2) * CARD_PITCH, HAND_ROWS[row]!);
}

test("Pact plays alone on /play: bids and cards by key and by tap", async ({ page }) => {
  // The other seats play at the board's own pace, about a second a card, so a few tricks take a while.
  test.setTimeout(120_000);
  await page.goto("/play/pact?seed=smoke");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("pact-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  // hand:tricks:phase | your thirteen cards | the trick | each seat's bid and tricks.
  await expect(page.getByTestId("pact-board")).toHaveAttribute("data-board", /^1:0:(bid|table)\|([2-9TJQKA][cdhs]){13}\|[^|]*\|([-n0-9]+\/0,){3}[-n0-9]+\/0$/);

  // The other seats bid at the board's own pace until it is the player's turn.
  let phase = await waitFor(page);
  expect(phase).toBe("bid");
  let moves = 0;
  // Keyboard: a number picks the bid and enter makes it.
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText(String(++moves));
  phase = await waitFor(page);
  // Keyboard: enter plays the first card that may be played.
  for (let i = 0; i < 2 && phase === "play"; i++) {
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("hud-moves")).toHaveText(String(++moves));
    phase = await waitFor(page);
  }
  // Pointer: tap cards left to right until one may be played; a card that may not does nothing.
  for (let i = 0; i < 2 && phase === "play"; i++) {
    const n = await handSize(page);
    for (let k = 0; k < n; k++) {
      await tapCard(page, k, n);
      if ((await page.getByTestId("hud-moves").textContent()) === String(moves + 1)) break;
    }
    await expect(page.getByTestId("hud-moves")).toHaveText(String(++moves));
    phase = await waitFor(page);
  }
  await expect(page.getByTestId("hud-hand")).toHaveText(/^1 of \d+$/);
});

test("Pact takes a bid by tap: a number, then the bid button", async ({ page }) => {
  await page.goto("/play/pact?seed=smoke-tap");
  await page.getByTestId("play-start").click();
  expect(await waitFor(page)).toBe("bid");
  // The bid of 2 sits third in the first row (nil, 1, 2, 3, 4).
  await tapUnit(page, 5 + (2 - 2) * BID_PITCH, BID_ROWS[0]!);
  await tapUnit(page, 5, BUTTON_Y);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expect(page.getByTestId("pact-board")).toHaveAttribute("data-board", /\|2\/0,[^|]*$/);
});
