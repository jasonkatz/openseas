import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** Wait for the board to settle on the player's decision, or between hands. */
async function waitFor(page: Page, phase: "act" | "over" | "act|over|finished"): Promise<string> {
  const canvas = page.getByTestId("showdown-canvas");
  await expect(canvas).toHaveAttribute("data-phase", new RegExp(`^(${phase})$`), { timeout: 20_000 });
  await expectViewMatchesState(page, "showdown");
  return (await canvas.getAttribute("data-phase")) ?? "";
}

/** Tap the k-th of the three buttons, left to right; between hands the one wide button covers them all. */
async function tapButton(page: Page, k: number): Promise<void> {
  const { ox, oy, cell } = await boardGeom(page, "showdown");
  await page.mouse.click(ox + (k + 0.5) * cell, oy + cell / 2);
}

test("Showdown plays alone on /play: a game plays by key and by tap", async ({ page }) => {
  // The rivals act on the board's own unhurried pace: a few hands take a while.
  test.setTimeout(120_000);
  await page.goto("/play/showdown?seed=smoke");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("showdown-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  // hand:street:pot | your two cards and chips | the middle | each rival, in, folded or out, with its chips.
  await expect(page.getByTestId("showdown-board")).toHaveAttribute("data-board", /^1:0:\d+\|([2-9TJQKA][smrc]){2}\/\d+\|\|(i\d+\|){2}i\d+$/);

  // The rivals act on the board's own pace until it is the player's turn.
  let phase = await waitFor(page, "act|over|finished");
  let decisions = 0;
  // Keyboard: call (or check) whenever it is the player's turn; space deals the next hand.
  for (let i = 0; i < 3 && phase !== "finished"; i++) {
    if (phase === "act") {
      await page.keyboard.press("c");
      decisions++;
      await expect(page.getByTestId("hud-moves")).toHaveText(String(decisions));
    } else await page.keyboard.press(" ");
    phase = await waitFor(page, "act|over|finished");
  }

  // Pointer: the middle button calls, or deals between hands.
  const hand = (await page.getByTestId("showdown-board").getAttribute("data-board"))!.split(":")[0];
  for (let i = 0; i < 6 && phase !== "finished"; i++) {
    const before = phase;
    await tapButton(page, 1);
    if (before === "act") {
      decisions++;
      await expect(page.getByTestId("hud-moves")).toHaveText(String(decisions));
    }
    phase = await waitFor(page, "act|over|finished");
  }
  const now = (await page.getByTestId("showdown-board").getAttribute("data-board"))!.split(":")[0];
  expect(Number(now)).toBeGreaterThanOrEqual(Number(hand));
  if (phase !== "finished") await expect(page.getByTestId("hud-hand")).toHaveText(/^\d+$/);
});
