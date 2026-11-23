import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content shaft: eight lanes over six rows of rockers. */
const W = 8;
const ROWS = 6;

async function tapLane(page: Page, lane: number, row = 2): Promise<void> {
  const { ox, oy, cell } = await boardGeom(page, "freefall");
  await page.mouse.click(ox + (lane + 0.5) * cell, oy + (row + 0.5) * cell);
}

test("Freefall plays alone on /play: a round drops by key and by tap", async ({ page }) => {
  await page.goto("/play/freefall");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("freefall-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expect(page.getByTestId("freefall-board")).toHaveAttribute("data-board", new RegExp(`^([.CPa]{${W}}\\|){${ROWS - 1}}[.CPa]{${W}}$`));
  await expectViewMatchesState(page, "freefall");

  // Keyboard: pick a lane and drop.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-cursor", "1");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "freefall");

  // Pointer: a tap anywhere down a lane drops a pod down it.
  await tapLane(page, 5);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expect(canvas).toHaveAttribute("data-cursor", "5");
  await expectViewMatchesState(page, "freefall");

  // A few more drops, each answered by the rival: the shaft always ends as the engine holds it.
  for (const lane of [0, 7, 3, 4]) {
    await tapLane(page, lane, 0);
    await expectViewMatchesState(page, "freefall");
  }
  await expect(page.getByTestId("hud-moves")).toHaveText("6");
  await expect(page.getByTestId("hud-leg")).toHaveText(/^[1-4] of 4$/);
});
