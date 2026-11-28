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

/**
 * Every port a beam from `entry` leaves by, with the lenses each branch passed, as the rules have it:
 * ports run along the top, the right, the bottom, then the left; a splitter (`*`) sends the beam on
 * both ways across it; a branch that comes again to a cell heading a way already gone stops.
 */
function leavesBy(grid: string, entry: number): Array<{ out: number; lenses: number }> {
  const i = entry % N;
  const start = [[i, 0, 2], [N - 1, i, 3], [i, N - 1, 0], [0, i, 1]][Math.floor(entry / N)] as [number, number, number];
  const seen = new Set<number>();
  const out: Array<{ out: number; lenses: number }> = [];
  const todo: Array<[number, number, number, number]> = [[...start, 0]];
  while (todo.length > 0 && out.length < 16) {
    let [col, row, dir, lenses] = todo.shift()!;
    let ended = false;
    for (;;) {
      if (col < 0 || col >= N || row < 0 || row >= N) break;
      const key = (row * N + col) * 4 + dir;
      if (seen.has(key)) {
        ended = true;
        break;
      }
      seen.add(key);
      const ch = grid[row * N + col]!;
      if (ch === "/") dir ^= 1;
      else if (ch === "\\") dir = 3 - dir;
      else if (ch === "*") {
        for (const d of [(dir + 3) % 4, (dir + 1) % 4]) todo.push([col + DX[d]!, row + DY[d]!, d, lenses]);
        ended = true;
        break;
      } else if (ch >= "a" && ch <= "c") lenses |= 1 << (ch.charCodeAt(0) - 97);
      col += DX[dir]!;
      row += DY[dir]!;
    }
    if (!ended) out.push({ out: [col - DX[dir]!, N + row - DY[dir]!, 2 * N + col - DX[dir]!, 3 * N + row - DY[dir]!][dir]!, lenses });
  }
  return out;
}

/** How many targets a shot through `grid` lights, each once. */
function lit(grid: string, targets: readonly Target[]): number {
  const done = new Set<number>();
  for (const e of EMITTERS) {
    for (const t of leavesBy(grid, e)) {
      const hit = targets.findIndex((g, i) => !done.has(i) && g.port === t.out && g.recipe === t.lenses);
      if (hit >= 0) done.add(hit);
    }
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

for (const [path, on] of [["/play/deflectors", ""], ["/play/rungs/deflectors", ", on the new engine"]] as const) test(`Deflectors plays alone on /play: a round puts pieces down by key and by tap, and bins them${on}`, async ({ page }) => {
  await page.goto(`${path}`);
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

  // X bins the next piece until a mirror is next: the queue moves up and the grid stays as it was.
  for (let i = 0; i < 12 && !isMirror((await board(page)).queue[0] ?? ""); i++) {
    const was = await board(page);
    await page.keyboard.press("x");
    await expect.poll(async () => (await board(page)).queue.slice(0, -1)).toBe(was.queue.slice(1));
    expect((await board(page)).grid).toBe(was.grid);
  }
  // A mirror is next, and R turns it before it goes down; a tap puts it on another cell, over what is there.
  expect(isMirror((await board(page)).queue[0] ?? "")).toBe(true);
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
  // The round is under way once the queue shows its pieces.
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

/** A touch gesture on the canvas, as pointer events: down at the first point, through the rest, up at the last. */
async function touchPath(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<void> {
  await page.evaluate(
    async (pts) => {
      const canvas = document.querySelector('[data-testid="deflectors-canvas"]') as HTMLCanvasElement;
      const send = (type: string, [x, y]: readonly [number, number], on: EventTarget): void => {
        on.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === "pointerup" ? 0 : 1 }));
      };
      send("pointerdown", pts[0]!, canvas);
      for (const p of pts.slice(1)) {
        send("pointermove", p, canvas);
        await new Promise((r) => requestAnimationFrame(r));
      }
      send("pointerup", pts[pts.length - 1]!, canvas);
    },
    points.map((p) => [p[0], p[1]] as const),
  );
}

test("on touch, the next piece is dragged from the queue and dropped on a cell; a tap on the grid places nothing", async ({ page }) => {
  await page.goto("/play/deflectors?seed=smoke-9&start=lab");
  await expect(page.getByTestId("deflectors-canvas")).toBeVisible();
  await expect.poll(async () => (await board(page)).queue.length, { timeout: 5_000 }).toBeGreaterThan(1);
  const { ox, oy, cell: size } = await boardGeom(page, "deflectors");
  // The board's geometry is in page pixels, as pointer events want. The queue head sits under the grid's ring.
  const head = [ox + (N * size) / 2 - size * 1.2, oy + size * (N + 1.36 + 0.65)] as const;

  // A tap on an empty cell places nothing.
  const start = await board(page);
  const empty = [...start.grid].findIndex((ch) => ch === ".");
  const centre = (c: number): readonly [number, number] => [ox + ((c % N) + 0.5) * size, oy + (Math.floor(c / N) + 0.5) * size];
  await touchPath(page, [centre(empty), centre(empty)]);
  await page.waitForTimeout(300);
  expect((await board(page)).grid).toBe(start.grid);

  // A drag from the queue head, the piece riding above the finger, drops it on the cell under the piece.
  const target = [...start.grid].findIndex((ch, i) => ch === "." && i !== empty && Math.floor(i / N) < N - 1);
  const [tx, ty] = centre(target);
  const lift = size * 0.8;
  const steps: Array<readonly [number, number]> = [];
  for (let k = 0; k <= 12; k++) steps.push([head[0] + ((tx - head[0]) * k) / 12, head[1] + ((ty + lift - head[1]) * k) / 12]);
  await touchPath(page, steps);
  await expect.poll(async () => (await board(page)).grid[target]).toBe(start.queue[0]);
  await expectViewMatchesState(page, "deflectors");
});
