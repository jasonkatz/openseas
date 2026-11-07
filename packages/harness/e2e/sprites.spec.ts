import { expect, test } from "@playwright/test";

// Exercise the production build: a working dev URL is not enough for shared-package assets.
test("all seven puzzle atlases load, draw, and survive a resize", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  let active = "initial";
  page.on("pageerror", (error) => errors.push(`${active}: ${error.stack}`));
  for (const puzzle of ["bilging", "sailing", "carpentry", "gunnery", "navigation", "swordfight", "battle"]) {
    active = puzzle;
    const image = page.waitForResponse((r) => r.url().includes(`/${puzzle}-`) && r.url().endsWith(".webp"));
    await page.goto(`/${puzzle}?seed=sprite-smoke&start=lab`);
    expect((await image).ok()).toBe(true);
    const canvas = page.getByTestId(`${puzzle}-canvas`);
    await expect(canvas).toHaveAttribute("data-sprite-atlas", puzzle);
    await expect(canvas).toBeVisible();
    // Let the round reach its first drawn state before capturing the art.
    await expect(canvas).toHaveAttribute("data-view", /.+/);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width - 12, height: viewport.height - 12 });
    await expect(canvas).toBeVisible();
    await testInfo.attach(`${puzzle}-sprites`, { body: await canvas.screenshot(), contentType: "image/png" });
    await page.setViewportSize(viewport);
  }
  expect(errors).toEqual([]);
});

test("an unavailable atlas falls back to playable procedural art", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/bilging");
  await page.getByTestId("start-unrated").click();
  await expect(page.getByTestId("bilging-canvas")).toHaveAttribute("data-sprite-atlas", "fallback");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  expect(errors).toEqual([]);
});
