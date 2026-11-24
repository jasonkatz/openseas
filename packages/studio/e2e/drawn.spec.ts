import { expect, test } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

/**
 * Every board draws its pieces in code (ADR 0062): the seven in the game and the eight prototypes.
 * Exercised on the production build, alone on `/play`: the board says its pieces are drawn, asks
 * the network for no image, shows the engine's board, and survives a resize. Each puzzle's own spec plays it.
 */
const PUZZLES = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight", "salvage", "overload", "deflectors", "reactor", "scanner", "tug", "racks", "cutting", "tractor", "refining", "freefall", "assembly"];

for (const puzzle of PUZZLES) {
  test(`${puzzle} draws its pieces in code, asks for no image and survives a resize`, async ({ page }) => {
    const errors: string[] = [];
    const images: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("request", (r) => {
      // A legend's pictogram is a data URL the page made itself: only what is asked of the network counts.
      if (r.resourceType() === "image" && /^https?:/.test(r.url())) images.push(r.url());
    });
    await page.goto(`/play/${puzzle}?seed=drawn-smoke`);
    await page.getByTestId("play-start").click();
    const canvas = page.getByTestId(`${puzzle}-canvas`);
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-view", /.+/);
    await expect(canvas).toHaveAttribute("data-pieces", "drawn");
    // No board names an atlas any more.
    await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
    await expectViewMatchesState(page, puzzle);
    // A new size bakes every piece again. A sprite left on a texture the resize destroyed throws
    // when it is next drawn, so resize twice and give the board frames to draw in.
    const viewport = page.viewportSize()!;
    for (const by of [12, 120, 0]) {
      await page.setViewportSize({ width: viewport.width - by, height: viewport.height - by });
      await page.waitForTimeout(250);
    }
    await expect(canvas).toBeVisible();
    await expectViewMatchesState(page, puzzle);
    expect(images).toEqual([]);
    expect(errors).toEqual([]);
  });
}
