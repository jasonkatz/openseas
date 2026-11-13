import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content field: seven wide, eight tall. */
const W = 7;
const H = 8;

const touching = (a: number, b: number): boolean => a !== b && Math.abs((a % W) - (b % W)) <= 1 && Math.abs(Math.floor(a / W) - Math.floor(b / W)) <= 1;

/** A line of `length` touching pieces of one kind of debris, read off the board string the page publishes. */
function findLine(board: string, length: number): number[] {
  const walk = (path: number[]): number[] | null => {
    if (path.length === length) return path;
    const last = path[path.length - 1]!;
    for (let c = 0; c < W * H; c++) {
      if (path.includes(c) || !touching(last, c) || board[c] !== board[last]) continue;
      const found = walk([...path, c]);
      if (found) return found;
    }
    return null;
  };
  for (let c = 0; c < W * H; c++) {
    if (!/\d/.test(board[c]!)) continue;
    const found = walk([c]);
    if (found) return found;
  }
  throw new Error(`no line of ${length} on ${board}`);
}

/** The key that moves the cursor one cell in each of the eight directions. */
const STEP_KEY: Record<string, string> = { "-1,-1": "q", "0,-1": "ArrowUp", "1,-1": "e", "-1,0": "ArrowLeft", "1,0": "ArrowRight", "-1,1": "z", "0,1": "ArrowDown", "1,1": "c" };

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("salvage-board").getAttribute("data-board");
  if (!board || board.length !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

async function drag(page: Page, cells: readonly number[]): Promise<void> {
  const { ox, oy, cell } = await boardGeom(page, "salvage");
  const at = (c: number): [number, number] => [ox + ((c % W) + 0.5) * cell, oy + (Math.floor(c / W) + 0.5) * cell];
  await page.mouse.move(...at(cells[0]!));
  await page.mouse.down();
  for (const c of cells.slice(1)) await page.mouse.move(...at(c), { steps: 6 });
  await page.mouse.up();
}

test("home links to Salvage and an unrated round hauls a line by key and by drag", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-salvage").click();
  await expect(page).toHaveURL(/\/salvage$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("salvage-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "salvage");

  // Keyboard: walk the cursor to the line's first piece, start the line, draw it, haul it.
  const line = findLine(await boardString(page), 3);
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  const first = line[0]!;
  for (let c = col; c < first % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > first % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(first / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(first / W); r--) await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  for (let i = 1; i < line.length; i++) {
    const dc = (line[i]! % W) - (line[i - 1]! % W);
    const dr = Math.floor(line[i]! / W) - Math.floor(line[i - 1]! / W);
    await page.keyboard.press(STEP_KEY[`${dc},${dr}`]!);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "salvage");

  // Pointer: drag through another line.
  await drag(page, findLine(await boardString(page), 3));
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "salvage");
});

test("a Salvage line closed into a loop nets the crates on the field", async ({ page }) => {
  // A pinned lab seed whose opening holds a loop of four round nothing, with two crates adrift.
  await page.goto("/salvage?seed=loop-1&start=lab");
  const canvas = page.getByTestId("salvage-canvas");
  await expect(canvas).toBeVisible();
  await expectViewMatchesState(page, "salvage");
  await expect(page.getByTestId("salvage-board")).toHaveAttribute("data-board", /^(?:[^C]*C){2}[^C]*$/);
  // The line, then back onto its first piece to close it.
  await drag(page, [3, 11, 18, 10, 3]);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  // Four pieces doubled for the loop, and two crates at 50 times two times two.
  await expect(page.getByTestId("hud-score")).toHaveText("232");
  await expectViewMatchesState(page, "salvage");
});
