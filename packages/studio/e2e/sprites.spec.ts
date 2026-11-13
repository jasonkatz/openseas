import { expect, test } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

// Exercise the production build: a working dev URL is not enough for shared-package assets.
// The seven core boards, then the eight prototypes, which load theirs through the board kit (ADR 0037).
const CORE = ["cooling", "engines", "plating", "gunnery", "navigation", "swordfight", "battle"];
const PROTOTYPES = ["salvage", "overload", "deflectors", "reactor", "scanner", "tug", "racks", "cutting"];

for (const puzzle of [...CORE, ...PROTOTYPES]) {
  test(`${puzzle} atlas loads, draws, and survives a resize`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const image = page.waitForResponse((r) => r.url().includes(`/${puzzle}-`) && r.url().endsWith(".webp"));
    await page.goto(`/play/${puzzle}?seed=sprite-smoke&start=lab&paused=1`);
    expect((await image).ok()).toBe(true);
    const canvas = page.getByTestId(`${puzzle}-canvas`);
    await expect(canvas).toHaveAttribute("data-sprite-atlas", puzzle);
    await expect(canvas).toBeVisible();
    // Let the round reach its first drawn state before capturing the art.
    await expect(canvas).toHaveAttribute("data-view", /.+/);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width - 12, height: viewport.height - 12 });
    await expect(canvas).toBeVisible();
    // A diagnostic capture must not wait for an animated canvas to become a stable element.
    // The lab clock is paused; viewport capture also avoids element-screenshot scroll/stability waits.
    await testInfo.attach(`${puzzle}-sprites`, { body: await page.screenshot(), contentType: "image/png" });
    await page.setViewportSize(viewport);
    expect(errors).toEqual([]);
  });
}

test("an unavailable atlas falls back to playable procedural art", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/play/cooling");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("cooling-canvas")).toHaveAttribute("data-sprite-atlas", "fallback");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  expect(errors).toEqual([]);
});

test("a kit board with no atlas draws its pieces in code and still plays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/play/overload?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("overload-canvas");
  await expect(canvas).toHaveAttribute("data-sprite-atlas", "fallback");
  await expectViewMatchesState(page, "overload");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "overload");
  expect(errors).toEqual([]);
});
