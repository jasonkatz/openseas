import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content grid: six by six, a port at each end of every row and column. */
const N = 6;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

interface Beam {
  entry: number;
  exit: number;
}

/** What the page publishes: the grid, one character a cell, and the waiting beams as sign:entry>exit. */
async function board(page: Page): Promise<{ grid: string; beams: Beam[] }> {
  const text = (await page.getByTestId("deflectors-board").getAttribute("data-board")) ?? "";
  const [grid = "", waiting = ""] = text.split("|");
  if (grid.length !== N * N) throw new Error(`unexpected board ${text}`);
  const beams = waiting === "" ? [] : waiting.split(",").map((b) => ({ entry: Number(b.split(":")[1]!.split(">")[0]), exit: Number(b.split(">")[1]) }));
  return { grid, beams };
}

/** The port a beam from `entry` leaves by, as the rules have it: ports run along the top, the right, the bottom, then the left. */
function leavesBy(grid: string, entry: number): number {
  const i = entry % N;
  let [col, row, dir] = [[i, 0, 2], [N - 1, i, 3], [i, N - 1, 0], [0, i, 1]][Math.floor(entry / N)] as [number, number, number];
  for (let step = 0; step < 200; step++) {
    if (col < 0 || col >= N || row < 0 || row >= N) break;
    const ch = grid[row * N + col];
    if (ch === "/") dir ^= 1;
    else if (ch === "\\") dir = 3 - dir;
    col += DX[dir]!;
    row += DY[dir]!;
  }
  return [col - DX[dir]!, N + row - DY[dir]!, 2 * N + col - DX[dir]!, 3 * N + row - DY[dir]!][dir]!;
}

const flipped = (grid: string, cell: number): string => grid.slice(0, cell) + (grid[cell] === "/" ? "\\" : "/") + grid.slice(cell + 1);

/** The fewest mirrors to flip so every beam leaves by its exit. */
function solve(grid: string, beams: readonly Beam[]): number[] {
  const mirrors = [...grid].flatMap((ch, c) => (ch === "." ? [] : [c]));
  const home = (g: string): boolean => beams.every((b) => leavesBy(g, b.entry) === b.exit);
  let frontier: { grid: string; flips: number[] }[] = [{ grid, flips: [] }];
  for (let depth = 0; depth <= 5; depth++) {
    const found = frontier.find((f) => home(f.grid));
    if (found) return found.flips;
    frontier = frontier.flatMap((f) => mirrors.filter((c) => c > (f.flips[f.flips.length - 1] ?? -1)).map((c) => ({ grid: flipped(f.grid, c), flips: [...f.flips, c] })));
  }
  throw new Error(`no route within five flips on ${grid}`);
}

async function tapCell(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "deflectors");
  await page.mouse.click(ox + ((cell % N) + 0.5) * size, oy + (Math.floor(cell / N) + 0.5) * size);
}

async function tapPort(page: Page, port: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "deflectors");
  const at = (port % N) + 0.5;
  const [x, y] = [[at, -0.5], [N + 0.5, at], [at, N + 0.5], [-0.5, at]][Math.floor(port / N)] as [number, number];
  await page.mouse.click(ox + x * size, oy + y * size);
}

test("Deflectors plays alone on /play: a round flips a mirror by key and by tap", async ({ page }) => {
  await page.goto("/play/deflectors");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("deflectors-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "deflectors");

  // Keyboard: walk the cursor to a mirror and flip it.
  const { grid } = await board(page);
  const mirrors = [...grid].flatMap((ch, c) => (ch === "." ? [] : [c]));
  const first = mirrors[0]!;
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < first % N; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > first % N; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(first / N); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(first / N); r--) await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect.poll(async () => (await board(page)).grid).toBe(flipped(grid, first));
  await expectViewMatchesState(page, "deflectors");

  // Pointer: tap another mirror, and an empty cell, which does nothing.
  const second = mirrors[mirrors.length - 1]!;
  await tapCell(page, second);
  await expect.poll(async () => (await board(page)).grid).toBe(flipped(flipped(grid, first), second));
  await tapCell(page, [...grid].findIndex((ch) => ch === "."));
  await expectViewMatchesState(page, "deflectors");
  expect((await board(page)).grid).toBe(flipped(flipped(grid, first), second));
});

test("a Deflectors beam routed home and fired from its port scores, and the F key fires the next volley as it stands", async ({ page }) => {
  // A pinned lab seed whose first beam is one flip from home.
  await page.goto("/play/deflectors?seed=smoke-9&start=lab");
  await expect(page.getByTestId("deflectors-canvas")).toBeVisible();
  // The first volley is announced within a second: one beam, not home as the mirrors stand.
  await expect.poll(async () => (await board(page)).beams.length).toBe(1);
  const { grid, beams } = await board(page);
  const home = (b: { grid: string; beams: Beam[] }): boolean => b.beams.length > 0 && b.beams.every((x) => leavesBy(b.grid, x.entry) === x.exit);
  expect(home({ grid, beams })).toBe(false);
  const flips = solve(grid, beams);
  expect(flips.length).toBe(1);
  for (const cell of flips) await tapCell(page, cell);
  await expect.poll(async () => home(await board(page))).toBe(true);
  await expectViewMatchesState(page, "deflectors");
  await expect(page.getByTestId("hud-score")).toHaveText("0");

  // A tap on the lit entry fires the volley before its count ends.
  await tapPort(page, beams[0]!.entry);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expect.poll(async () => Number(await page.getByTestId("hud-score").textContent())).toBeGreaterThan(0);

  // The next volley comes after a short pause; F fires it where it stands.
  await expect.poll(async () => (await board(page)).beams.length).toBeGreaterThan(0);
  await expectViewMatchesState(page, "deflectors");
  await expect(async () => {
    await page.keyboard.press("f");
    expect(Number(await page.getByTestId("hud-moves").textContent())).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 10_000 });
});
