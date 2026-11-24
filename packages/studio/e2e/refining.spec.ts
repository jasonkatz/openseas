import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content tower: six wide, five tall, packed as a honeycomb whose columns stand DX cells apart. */
const W = 6;
const H = 5;
const DX = 0.88;

/** Where a board character stands in the cycle vapour, oil, tar: smoke stands as vapour, a catalyst nowhere. */
const pos = (ch: string): number | null => ({ v: 0, s: 0, o: 1, t: 2 })[ch] ?? null;
/** A diagonal pair swaps when the upper and lower are vapour over tar, tar over oil or oil over vapour. */
const linked = (upper: string, lower: string): boolean => {
  const x = pos(upper);
  const y = pos(lower);
  return x !== null && y !== null && y === (x + 2) % 3;
};

type Dir = "upRight" | "downRight";
const low = (col: number, phase: number): boolean => ((col + phase) & 1) === 1;

/** The cell a swap from `c` going `dir` pairs it with, or -1: every other column sits half a piece low, as `data-phase` says. */
function partner(c: number, dir: Dir, phase: number): number {
  const col = c % W;
  const row = Math.floor(c / W);
  if (col >= W - 1) return -1;
  const r = dir === "upRight" ? (low(col, phase) ? row : row - 1) : low(col, phase) ? row + 1 : row;
  return r >= 0 && r < H ? r * W + col + 1 : -1;
}

/** Whether the pair `c` makes going `dir` may swap: up-right puts the partner above, down-right below. */
function pairLinked(board: string, c: number, dir: Dir, phase: number): boolean {
  const b = partner(c, dir, phase);
  if (b < 0) return false;
  return dir === "upRight" ? linked(board[b]!, board[c]!) : linked(board[c]!, board[b]!);
}

/** Whether the pieces at `a` and `b` touch and may swap, whichever way round they lie. */
function canSwap(board: string, a: number, b: number, phase: number): boolean {
  for (const dir of ["upRight", "downRight"] as const) {
    if (partner(a, dir, phase) === b) return pairLinked(board, a, dir, phase);
    if (partner(b, dir, phase) === a) return pairLinked(board, b, dir, phase);
  }
  return false;
}

/** A legal swap read off the board string the page publishes: its first cell and its neighbour. With `level`, only one whose partner is the same row of the next column. */
function findSwap(board: string, phase: number, level = false): { a: number; b: number } {
  for (let c = 0; c < W * H; c++) {
    for (const dir of ["upRight", "downRight"] as const) {
      const b = partner(c, dir, phase);
      if (b < 0 || (level && Math.floor(b / W) !== Math.floor(c / W))) continue;
      if (pairLinked(board, c, dir, phase)) return { a: c, b };
    }
  }
  throw new Error(`no swap on ${board}`);
}

/** A piece that one drag can carry through two swaps: a to b, then on from b to c. */
function findChain(board: string, phase: number): [number, number, number] | null {
  for (let a = 0; a < W * H; a++) {
    for (let b = 0; b < W * H; b++) {
      if (!canSwap(board, a, b, phase)) continue;
      const once = swapped(board, a, b);
      for (let c = 0; c < W * H; c++) if (c !== a && c !== b && canSwap(once, b, c, phase)) return [a, b, c];
    }
  }
  return null;
}

async function phaseOf(page: Page): Promise<number> {
  return Number(await page.getByTestId("refining-canvas").getAttribute("data-phase"));
}

/** A cell's centre on the page. */
function centre(g: { ox: number; oy: number; cell: number }, c: number, phase: number): [number, number] {
  const col = c % W;
  return [g.ox + (0.5 + col * DX) * g.cell, g.oy + (Math.floor(c / W) + 0.5 + (low(col, phase) ? 0.5 : 0)) * g.cell];
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

  // Keyboard: walk the cursor to a swap with the same row of the next column, pick with space, swap with the arrow right.
  const before = await boardString(page);
  const level = findSwap(before, await phaseOf(page), true);
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < level.a % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > level.a % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(level.a / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(level.a / W); r--) await page.keyboard.press("ArrowUp");
  await expect(canvas).toHaveAttribute("data-cursor", `${level.a % W},${Math.floor(level.a / W)}`);
  await page.keyboard.press(" ");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  expect(await boardString(page)).toBe(swapped(before, level.a, level.b));
  await expectViewMatchesState(page, "refining");

  // Pointer: drag a piece across the honeycomb onto the neighbour it is linked to.
  const mid = await boardString(page);
  const phase = await phaseOf(page);
  const right = findSwap(mid, phase);
  const g = await boardGeom(page, "refining");
  const [x, y] = centre(g, right.a, phase);
  const [tx, ty] = centre(g, right.b, phase);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 6 });
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
  await page.mouse.click(g.ox + (0.5 + (W - 1) * DX) * g.cell, g.oy - g.cell * 0.95 * 0.5);
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

test("one Refining drag carries its piece through every swap it is dragged over", async ({ page }) => {
  await page.goto("/play/refining?seed=chain&start=1&paused=1&hints=0");
  await expect(page.getByTestId("refining-canvas")).toBeVisible();
  const before = await boardString(page);
  const phase = await phaseOf(page);
  const chain = findChain(before, phase);
  if (!chain) throw new Error(`no chain on ${before}`);
  const [a, b, c] = chain;
  const g = await boardGeom(page, "refining");
  const [x, y] = centre(g, a, phase);
  const [bx, by] = centre(g, b, phase);
  const [cx, cy] = centre(g, c, phase);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 6 });
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await page.mouse.move(cx, cy, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  expect(await boardString(page)).toBe(swapped(swapped(before, a, b), b, c));
  await expectViewMatchesState(page, "refining");
});

test("a Refining round started from the start card draws the tower it was dealt, not the preview behind the card", async ({ page }) => {
  await page.goto("/play/refining?hints=0");
  await expect(page.getByTestId("play-start")).toBeVisible();
  await expectViewMatchesState(page, "refining");
  const preview = await boardString(page);
  await page.getByTestId("play-start").click();
  await expect.poll(() => boardString(page)).not.toBe(preview);
  await expectViewMatchesState(page, "refining");
});
