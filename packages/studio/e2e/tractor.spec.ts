import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content field: six wide, nine tall. */
const W = 6;
const H = 9;

/** The loot kind a board character stands for: a digit, or a beacon's letter. Null for a cache. */
function kindOf(ch: string): number | null {
  if (/\d/.test(ch)) return Number(ch);
  if (ch >= "a" && ch <= "h") return ch.charCodeAt(0) - 97;
  if (ch >= "n" && ch <= "u") return ch.charCodeAt(0) - 110;
  return null;
}

/** True when the board, read as kinds, holds a run of three through `cell`. */
function runAt(kinds: ReadonlyArray<number | null>, cell: number): boolean {
  const k = kinds[cell];
  if (k === null || k === undefined) return false;
  const col = cell % W;
  const row = Math.floor(cell / W);
  const count = (dc: number, dr: number): number => {
    let n = 0;
    for (let c = col + dc, r = row + dr; c >= 0 && c < W && r >= 0 && r < H && kinds[r * W + c] === k; c += dc, r += dr) n++;
    return n;
  };
  return count(1, 0) + count(-1, 0) + 1 >= 3 || count(0, 1) + count(0, -1) + 1 >= 3;
}

/** The top cell of a pair whose swap makes a run, read off the board string the page publishes. */
function findSwap(board: string): number {
  const kinds = board.split("").map(kindOf);
  for (let c = 0; c < W * (H - 1); c++) {
    const a = kinds[c];
    const b = kinds[c + W];
    if (a === null || b === null || a === b) continue;
    const after = kinds.slice();
    after[c] = b!;
    after[c + W] = a!;
    if (runAt(after, c) || runAt(after, c + W)) return c;
  }
  throw new Error(`no scoring swap on ${board}`);
}

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("tractor-board").getAttribute("data-board");
  if (!board || board.length !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

async function dragDown(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "tractor");
  const x = ox + ((cell % W) + 0.5) * size;
  const y = oy + (Math.floor(cell / W) + 0.5) * size;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + size * 0.8, { steps: 6 });
  await page.mouse.up();
}

async function tap(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "tractor");
  await page.mouse.click(ox + ((cell % W) + 0.5) * size, oy + (Math.floor(cell / W) + 0.5) * size);
}

for (const [path, on] of [["/play/tractor", ""], ["/play/rungs/tractor", ", on the new engine"]] as const) test(`Tractor plays alone on /play: a round swaps by key, by drag and by two taps${on}`, async ({ page }) => {
  await page.goto(`${path}`);
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("tractor-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "tractor");

  // Keyboard: walk the pair to a scoring swap and swap it.
  const first = findSwap(await boardString(page));
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < first % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > first % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(first / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(first / W); r--) await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "tractor");

  // Pointer: drag a piece down onto the one under it.
  await dragDown(page, findSwap(await boardString(page)));
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "tractor");

  // Two taps: a piece, then the piece under it.
  const third = findSwap(await boardString(page));
  await tap(page, third);
  await tap(page, third + W);
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  await expectViewMatchesState(page, "tractor");
});

test("a Tractor stage plays from its address: its name in the HUD, its card on the start card, its numbers on the board (ADR 0066)", async ({ page }) => {
  await page.goto("/play/tractor?stage=runs");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "runs");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("tractor-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "runs");
  // The first stage deals loot only: no cache and no beacon, and a minute on the clock.
  await expect(page.getByTestId("tractor-board")).toHaveAttribute("data-board", /^[0-9]+$/);
  await expect(page.getByTestId("hud-time").first()).toHaveText(/^(1:00|0:5\d)$/);
  await dragDown(page, findSwap(await boardString(page)));
  await expect(page.getByTestId("hud-moves").first()).toHaveText("1");
  await expectViewMatchesState(page, "tractor");
});
