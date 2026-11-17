import { expect, test } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

// Exercise the production build: a working dev URL is not enough for shared-package assets. Each
// atlas is built from its frame files by the build (ADR 0054) and served under its own name.
// The core boards M10 has not restyled yet, then the eight prototypes, which load theirs through the
// board kit (ADR 0037). A restyled board draws its pieces in code and loads no atlas (ADR 0062): Cooling, Gunnery,
// Plating, Navigation, Swordfighting, Space Battle.
const CORE = ["engines"];
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

test("a restyled board asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/cooling");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("cooling-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "cooling");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Gunnery asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/gunnery");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("gunnery-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("d");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "gunnery");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Navigation asks for no atlas and plays on stars drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/navigation");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("navigation-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "navigation");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Swordfighting asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/swordfight");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("swordfight-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-falling", /\d/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toContainText("1", { timeout: 30_000 });
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "swordfight");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Space Battle asks for no atlas and plays on ships drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/battle");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("battle-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await page.keyboard.press("w");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"forward"/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("battle-board")).toHaveAttribute("data-board", /^1:/);
  await expectViewMatchesState(page, "battle");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("an unavailable atlas falls back to playable procedural art", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/play/engines?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("engines-canvas");
  await expect(canvas).toHaveAttribute("data-sprite-atlas", "fallback");
  await expectViewMatchesState(page, "engines");
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
