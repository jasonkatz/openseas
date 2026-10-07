import { expect, test } from "@playwright/test";

/**
 * Smoke: the client builds, loads, and a Bilging round is playable without the server (unrated).
 * Rated play needs the server and is covered by the server integration test.
 */
test("home page renders and links to Bilging practice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas" })).toBeVisible();
  await page.getByRole("link", { name: /Bilging/ }).click();
  await expect(page).toHaveURL(/\/practice\/bilging$/);
  await expect(page.getByTestId("start-unrated")).toBeVisible();
});

test("an unrated Bilging round accepts a keyboard swap and shows the result", async ({ page }) => {
  await page.goto("/practice/bilging");
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("bilging-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");

  // Keyboard: put the cursor somewhere and swap with the piece to the right.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // Pointer: tap two horizontally adjacent cells.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const cell = Math.min(box.width / 6, box.height / 12);
  const ox = box.x + (box.width - cell * 6) / 2;
  const oy = box.y + (box.height - cell * 12) / 2;
  await page.mouse.click(ox + cell * 0.5, oy + cell * 11.5);
  await page.mouse.click(ox + cell * 1.5, oy + cell * 11.5);
  await expect(page.getByTestId("hud-moves")).toContainText("2");
});
