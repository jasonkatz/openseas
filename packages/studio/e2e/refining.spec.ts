import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content tower: six wide, five tall. */
const W = 6;
const H = 5;

/** Where a board character stands in the cycle vapour, oil, tar: smoke stands as vapour, a catalyst nowhere. */
const pos = (ch: string): number | null => ({ v: 0, s: 0, o: 1, t: 2 })[ch] ?? null;
const linked = (a: string, b: string): boolean => {
  const x = pos(a);
  const y = pos(b);
  return x !== null && y !== null && y === (x + 1) % 3;
};

/** A legal swap read off the board string the page publishes: its first cell and its neighbour. */
function findSwap(board: string, dir: "down" | "right"): { a: number; b: number } {
  for (let c = 0; c < W * H; c++) {
    const b = dir === "right" ? (c % W < W - 1 ? c + 1 : -1) : c + W < W * H ? c + W : -1;
    if (b >= 0 && linked(board[c]!, board[b]!)) return { a: c, b };
  }
  throw new Error(`no ${dir} swap on ${board}`);
}

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("refining-board").getAttribute("data-board");
  if (!board || board.length !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

const swapped = (board: string, a: number, b: number): string => {
  const s = board.split("");
  [s[a], s[b]] = [s[b]!, s[a]!];
  return s.join("");
};

/** Every column moved one place right, as a draw leaves the tower: columns 1 to W-1 are what 0 to W-2 were. */
const shiftedRight = (before: string, after: string): boolean => {
  for (let r = 0; r < H; r++) for (let c = 1; c < W; c++) if (after[r * W + c] !== before[r * W + c - 1] && after[r * W + c] !== "s") return false;
  return true;
};

test("Refining plays alone on /play: a swap by key and by pointer, and early draws by key and by the lamp", async ({ page }) => {
  // The clock is held still so nothing is drawn between reading the tower and swapping on it.
  await page.goto("/play/refining?seed=smoke&start=1&paused=1&hints=0");
  const canvas = page.getByTestId("refining-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "refining");

  // Keyboard: walk the cursor to a swap down, pick with space, swap with the arrow.
  const before = await boardString(page);
  const down = findSwap(before, "down");
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < down.a % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > down.a % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(down.a / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(down.a / W); r--) await page.keyboard.press("ArrowUp");
  await expect(canvas).toHaveAttribute("data-cursor", `${down.a % W},${Math.floor(down.a / W)}`);
  await page.keyboard.press(" ");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  expect(await boardString(page)).toBe(swapped(before, down.a, down.b));
  await expectViewMatchesState(page, "refining");

  // Pointer: drag a piece right onto the neighbour it is linked to.
  const mid = await boardString(page);
  const right = findSwap(mid, "right");
  const g = await boardGeom(page, "refining");
  const x = g.ox + ((right.a % W) + 0.5) * g.cell;
  const y = g.oy + (Math.floor(right.a / W) + 0.5) * g.cell;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + g.cell * 0.8, y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  expect(await boardString(page)).toBe(swapped(mid, right.a, right.b));
  await expectViewMatchesState(page, "refining");

  // Enter draws the outlet early: every column moves right and fresh feed comes in on the left.
  const preDraw = await boardString(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  expect(shiftedRight(preDraw, await boardString(page))).toBe(true);
  await expectViewMatchesState(page, "refining");

  // The lamp over the outlet draws too.
  const preLamp = await boardString(page);
  await page.mouse.click(g.ox + (W - 0.5) * g.cell, g.oy - g.cell * 0.95 * 0.5);
  await expect(page.getByTestId("hud-moves")).toHaveText("4");
  expect(shiftedRight(preLamp, await boardString(page))).toBe(true);
  await expectViewMatchesState(page, "refining");
});

test("the Refining clock draws the outlet by itself", async ({ page }) => {
  await page.goto("/play/refining?seed=clock&start=1&hints=0&speed=4");
  await expect(page.getByTestId("refining-canvas")).toBeVisible();
  const before = await boardString(page);
  await expect.poll(() => boardString(page), { timeout: 10_000 }).not.toBe(before);
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "refining");
});
