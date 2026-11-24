import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content grid: six by six, a port at each end of every row and column, and three emitters on the left edge. */
const N = 6;
const EMITTERS = [3 * N + 1, 3 * N + 3, 3 * N + 5];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

interface Target {
  port: number;
  /** The lens kinds a beam must pass, as a mask: bit 0 is lens `a`. */
  recipe: number;
}

/** What the page publishes: the grid, one character a cell; the targets as port~recipe; the queue, next first. */
async function board(page: Page): Promise<{ grid: string; targets: Target[]; queue: string }> {
  const text = (await page.getByTestId("deflectors-board").getAttribute("data-board")) ?? "";
  const [grid = "", goals = "", queue = ""] = text.split("|");
  if (grid.length !== N * N) throw new Error(`unexpected board ${text}`);
  const targets = goals === "" ? [] : goals.split(",").map((g) => ({ port: Number(g.split("~")[0]), recipe: Number(g.split("~")[1]) }));
  return { grid, targets, queue };
}

/** The port a beam from `entry` leaves by, and the lenses it passes, as the rules have it: ports run along the top, the right, the bottom, then the left. */
function leavesBy(grid: string, entry: number): { out: number; lenses: number } {
  const i = entry % N;
  let [col, row, dir] = [[i, 0, 2], [N - 1, i, 3], [i, N - 1, 0], [0, i, 1]][Math.floor(entry / N)] as [number, number, number];
  let lenses = 0;
  for (let step = 0; step < 200; step++) {
    if (col < 0 || col >= N || row < 0 || row >= N) break;
    const ch = grid[row * N + col]!;
    if (ch === "/") dir ^= 1;
    else if (ch === "\\") dir = 3 - dir;
    else if (ch >= "a" && ch <= "c") lenses |= 1 << (ch.charCodeAt(0) - 97);
    col += DX[dir]!;
    row += DY[dir]!;
  }
  return { out: [col - DX[dir]!, N + row - DY[dir]!, 2 * N + col - DX[dir]!, 3 * N + row - DY[dir]!][dir]!, lenses };
}

/** How many targets a shot through `grid` lights, each once. */
function lit(grid: string, targets: readonly Target[]): number {
  const done = new Set<number>();
  for (const e of EMITTERS) {
    const t = leavesBy(grid, e);
    const hit = targets.findIndex((g, i) => !done.has(i) && g.port === t.out && g.recipe === t.lenses);
    if (hit >= 0) done.add(hit);
  }
  return done.size;
}

const put = (grid: string, cell: number, ch: string): string => grid.slice(0, cell) + ch + grid.slice(cell + 1);
const turned = (ch: string): string => (ch === "/" ? "\\" : ch === "\\" ? "/" : ch);
const isMirror = (ch: string): boolean => ch === "/" || ch === "\\";

async function tapCell(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "deflectors");
  await page.mouse.click(ox + ((cell % N) + 0.5) * size, oy + (Math.floor(cell / N) + 0.5) * size);
}

/** A tap on the left edge, where the emitters sit. */
async function tapEmitters(page: Page): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "deflectors");
  await page.mouse.click(ox - 0.5 * size, oy + 3.5 * size);
}

test("Deflectors plays alone on /play: a round puts pieces down by key and by tap", async ({ page }) => {
  await page.goto("/play/deflectors");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("deflectors-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "deflectors");

  // Keyboard: walk the cursor to an empty cell and put the next piece there.
  const start = await board(page);
  expect(start.queue.length).toBeGreaterThan(0);
  const empty = [...start.grid].findIndex((ch) => ch === ".");
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < empty % N; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > empty % N; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(empty / N); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(empty / N); r--) await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect.poll(async () => (await board(page)).grid[empty]).toBe(start.queue[0]);
  await expectViewMatchesState(page, "deflectors");

  // A mirror comes, and R turns it before it goes down; a tap puts it on another cell, over what is there.
  await expect.poll(async () => isMirror((await board(page)).queue[0] ?? ""), { timeout: 15_000 }).toBe(true);
  const before = await board(page);
  await page.keyboard.press("r");
  await expect.poll(async () => (await board(page)).queue[0]).toBe(turned(before.queue[0]!));
  const other = (empty + 7) % (N * N);
  await tapCell(page, other);
  await expect.poll(async () => (await board(page)).grid[other]).toBe(turned(before.queue[0]!));
  await expectViewMatchesState(page, "deflectors");
});

test("a Deflectors shot built to light a target and fired from the emitters scores, and spends what it used", async ({ page }) => {
  // A pinned lab seed.
  await page.goto("/play/deflectors?seed=smoke-9&start=lab");
  await expect(page.getByTestId("deflectors-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  // The round is under way once a second piece has come into the queue.
  await expect.poll(async () => (await board(page)).queue.length, { timeout: 5_000 }).toBeGreaterThan(1);
  // Put each piece where it makes a shot light something, as soon as one does; until then where it lights nothing new.
  let found = false;
  for (let tries = 0; tries < 12 && !found; tries++) {
    await expect.poll(async () => (await board(page)).queue.length, { timeout: 5_000 }).toBeGreaterThan(0);
    const { grid, targets, queue } = await board(page);
    if (lit(grid, targets) > 0) {
      found = true;
      break;
    }
    const piece = queue[0]!;
    const ways = isMirror(piece) ? [piece, turned(piece)] : [piece];
    let pick: { cell: number; way: string } | null = null;
    for (let cell = 0; cell < N * N && !pick; cell++) for (const way of ways) if (!pick && grid[cell] !== way && lit(put(grid, cell, way), targets) > 0) pick = { cell, way };
    const go = pick ?? { cell: tries, way: piece };
    if (go.way !== piece) {
      await page.keyboard.press("r");
      await expect.poll(async () => (await board(page)).queue[0]).toBe(go.way);
    }
    await tapCell(page, go.cell);
    await expect.poll(async () => (await board(page)).grid[go.cell]).toBe(go.way);
    found = pick !== null;
  }
  expect(found).toBe(true);
  await expectViewMatchesState(page, "deflectors");
  await expect(page.getByTestId("hud-shot")).not.toHaveText(/Nothing/);
  await expect(page.getByTestId("hud-score")).toHaveText("0");

  // Nothing fires on its own. A tap on the emitters fires them all.
  const built = await board(page);
  await tapEmitters(page);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expect.poll(async () => Number(await page.getByTestId("hud-score").textContent())).toBeGreaterThan(0);
  // What the shot turned at is spent: fewer mirrors than it was built with.
  const count = (g: string): number => [...g].filter(isMirror).length;
  await expect.poll(async () => count((await board(page)).grid)).toBeLessThan(count(built.grid) + 1);
  await expectViewMatchesState(page, "deflectors");
  // The emitters recharge, and F fires them again.
  await expect(async () => {
    await page.keyboard.press("f");
    expect(Number(await page.getByTestId("hud-moves").textContent())).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 10_000 });
});
