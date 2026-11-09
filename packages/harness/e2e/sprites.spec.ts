import { expect, test } from "@playwright/test";

// Exercise the production build: a working dev URL is not enough for shared-package assets.
for (const puzzle of ["cooling", "engines", "plating", "gunnery", "navigation", "swordfight", "battle"]) {
  test(`${puzzle} atlas loads, draws, and survives a resize`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const image = page.waitForResponse((r) => r.url().includes(`/${puzzle}-`) && r.url().endsWith(".webp"));
    await page.goto(`/${puzzle}?seed=sprite-smoke&start=lab&paused=1`);
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
  await page.goto("/cooling");
  await page.getByTestId("start-unrated").click();
  await expect(page.getByTestId("cooling-canvas")).toHaveAttribute("data-sprite-atlas", "fallback");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  expect(errors).toEqual([]);
});
