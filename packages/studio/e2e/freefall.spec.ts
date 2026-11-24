import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content shaft: a tree four lanes wide at the top and eight at the foot, over seven rows of rockers. */
const W = 8;
const ROWS = 7;
/** The first of the entry lanes in the middle. */
const IN = 2;

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
  await expect(page.getByTestId("freefall-board")).toHaveAttribute("data-board", new RegExp(`^([ .CPa]{${W}}\\|){${ROWS - 1}}[.CPa]{${W}}$`));
  await expectViewMatchesState(page, "freefall");

  // Keyboard: pick a lane and drop.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-cursor", String(IN + 1));
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "freefall");

  // Pointer: a tap anywhere down a lane drops a pod down it.
  await tapLane(page, IN + 3);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expect(canvas).toHaveAttribute("data-cursor", String(IN + 3));
  await expectViewMatchesState(page, "freefall");

  // A few more drops, each answered by the rival: the shaft always ends as the engine holds it.
  // A tap outside the top row's lanes drops nothing.
  await tapLane(page, 0, 0);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  for (const lane of [IN, IN + 3, IN + 1, IN + 2]) {
    await tapLane(page, lane, 0);
    await expectViewMatchesState(page, "freefall");
  }
  await expect(page.getByTestId("hud-moves")).toHaveText("6");
  await expect(page.getByTestId("hud-leg")).toHaveText(/^[1-4] of 4$/);
});

test("Freefall's turn clock drops the lane in hand when a turn runs out", async ({ page }) => {
  // The shortest turn the schema takes, so the test waits five seconds, not thirty.
  await page.goto("/play/freefall?seed=turn-1&c.turnSeconds=5");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("freefall-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-time")).toHaveAttribute("data-turn", "");
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expect(page.getByTestId("hud-moves")).toHaveText("1", { timeout: 9_000 });
  await expectViewMatchesState(page, "freefall");
});
