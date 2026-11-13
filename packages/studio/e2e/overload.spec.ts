import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content bank: six wide, seven tall. */
const W = 6;
const H = 7;

/** A capacitor's charge off its character in the board string: a digit, or `a` to `d` for a booster at 0 to 3. */
const chargeOf = (ch: string): number => ("abcd".includes(ch) ? "abcd".indexOf(ch) : Number(ch));

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("overload-board").getAttribute("data-board");
  if (!board || board.length !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

async function tapCell(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "overload");
  await page.mouse.click(ox + ((cell % W) + 0.5) * size, oy + (Math.floor(cell / W) + 0.5) * size);
}

test("Overload plays alone on /play: a round charges a capacitor by key and bursts one by pointer", async ({ page }) => {
  await page.goto("/play/overload");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("overload-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "overload");

  // Keyboard: walk the cursor to a capacitor one tap will not burst, and charge it.
  const before = await boardString(page);
  const low = before.split("").findIndex((ch) => chargeOf(ch) < 2);
  expect(low).toBeGreaterThanOrEqual(0);
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < low % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > low % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(low / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(low / W); r--) await page.keyboard.press("ArrowUp");
  await expect(canvas).toHaveAttribute("data-cursor", `${low % W},${Math.floor(low / W)}`);
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expect(page.getByTestId("hud-score")).toHaveText("0");
  const primed = await boardString(page);
  expect(chargeOf(primed[low]!)).toBe(chargeOf(before[low]!) + 1);
  expect(primed.slice(0, low) + primed.slice(low + 1)).toBe(before.slice(0, low) + before.slice(low + 1));
  await expectViewMatchesState(page, "overload");

  // Pointer: tap the fullest capacitor until it bursts. Three taps are enough for any at one or more.
  const full = primed.split("").reduce((best, ch, i) => (chargeOf(ch) > chargeOf(primed[best]!) ? i : best), 0);
  const taps = 4 - chargeOf(primed[full]!);
  expect(taps).toBeLessThanOrEqual(3);
  for (let i = 0; i < taps; i++) {
    await tapCell(page, full);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(2 + i));
  }
  await expect(page.getByTestId("hud-score")).not.toHaveText("0");
  await expectViewMatchesState(page, "overload");
});

test("an Overload chain plays out and scores its length squared", async ({ page }) => {
  // A pinned lab seed whose opening holds a chain of six from one tap: four waves, no booster in it.
  await page.goto("/play/overload?seed=chain-219&start=lab");
  const canvas = page.getByTestId("overload-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("overload-board")).toHaveAttribute("data-board", "123011210331013320213101021b131011c1002010");
  await expectViewMatchesState(page, "overload");
  await tapCell(page, 9);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  // Six bursts at six a burst, at the first streak step of 100 percent.
  await expect(page.getByTestId("hud-score")).toHaveText("36");
  // The six spent capacitors were swapped for fresh ones, and the board drew the same bank once the chain had played.
  await expect(page.getByTestId("overload-board")).toHaveAttribute("data-board", "12312121223202b311222311022b131011c1002010");
  await expectViewMatchesState(page, "overload");
});
