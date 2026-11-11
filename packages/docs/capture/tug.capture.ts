import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createTugGame, reduceTug, tugSolve, tugStateViewString, type TugConfig, type TugMove, type TugState } from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.tug.config;
const W = cfg.width;
const H = cfg.height;
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"] as const;

type Flick = Extract<TugMove, { type: "flick" }>;

/** What lies on each side of a cell: up, right, down, left. */
function around(s: TugState, cell: number): ("wall" | "block" | "pod" | "free")[] {
  const col = cell % W;
  const row = Math.floor(cell / W);
  return DX.map((dx, d) => {
    const c = col + dx;
    const r = row + DY[d]!;
    if (c < 0 || c >= W || r < 0 || r >= H) return "wall";
    const k = r * W + c;
    return s.blocks.includes(k) ? "block" : s.pods.includes(k) ? "pod" : "free";
  });
}

/** A par route for the lit clamp, each flick with the slide it makes. */
function route(s: TugState): { move: Flick; cells: number; stop: string }[] | null {
  const moves = tugSolve(s);
  if (!moves) return null;
  const out: { move: Flick; cells: number; stop: string }[] = [];
  let g = s;
  for (const move of moves) {
    g = reduceTug(g, move);
    const sl = g.lastMove!.slide!;
    out.push({ move, cells: Math.abs((sl.to % W) - (sl.from % W)) + Math.abs(Math.floor(sl.to / W) - Math.floor(sl.from / W)), stop: sl.stop });
  }
  return out;
}

/** The clamp stands in the open: no wall, block or pod beside it, and not on the rim. */
const inOpen = (s: TugState): boolean => around(s, s.clamp.cell).every((x) => x === "free");

// ---- driving the page

/** The bay with the strip over it, without the canvas's empty margins: the renderer's own panel. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "tug");
  const pad = Math.max(4, g.cell * 0.12) + 6;
  return padded({ x: g.ox, y: g.oy - g.cell, width: g.cell * W, height: g.cell * (H + 1) }, pad, await canvasBox(page, "tug"));
}

let at: [number, number] = [2, 2];
/** Move the mouse there over `ms` of real time, however slowly the machine takes each step. */
async function moveTo(page: Page, x: number, y: number, ms: number): Promise<void> {
  const [x0, y0] = at;
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = k * k * (3 - 2 * k);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    if (k >= 1) break;
  }
  at = [x, y];
}

/** Wait until the page holds the bay Node holds, and has drawn it. */
async function inStep(page: Page, s: TugState): Promise<void> {
  const want = tugStateViewString(s);
  await expect.poll(() => boardString(page, "tug"), { timeout: 10_000 }).toBe(want);
  await settled(page, "tug");
}

/** Swipe a pod the way a thumb would, and keep the Node bay in step. */
async function swipe(page: Page, s: TugState, m: Flick, restMs = 380): Promise<TugState> {
  const g = await boardGeom(page, "tug");
  const cell = s.pods[m.pod]!;
  const x = g.ox + ((cell % W) + 0.5) * g.cell;
  const y = g.oy + (Math.floor(cell / W) + 0.5) * g.cell;
  await moveTo(page, x, y, 320);
  await page.mouse.down();
  await page.waitForTimeout(110);
  await moveTo(page, x + DX[m.dir]! * g.cell * 0.9, y + DY[m.dir]! * g.cell * 0.9, 170);
  await page.mouse.up();
  const next = reduceTug(s, m);
  await inStep(page, next);
  await page.waitForTimeout(restMs);
  return next;
}

/** The same flick by its keys, for play that is not in a picture. */
async function key(page: Page, s: TugState, m: Flick): Promise<TugState> {
  await page.keyboard.press(String(m.pod + 1));
  await page.keyboard.press(KEYS[m.dir]);
  const next = reduceTug(s, m);
  await inStep(page, next);
  return next;
}

async function open(page: Page, seed: string, over: Partial<TugConfig> = {}): Promise<TugState> {
  at = [2, 2];
  await openLab(page, "tug", { seed, config: over });
  const s = createTugGame(seed, { ...cfg, ...over });
  await inStep(page, s);
  return s;
}

/** A first clamp the wanted pod reaches by itself in two long flicks, the last against a wall or a block. */
const first = () =>
  findSeed("tug-first", (seed) => {
    const s = createTugGame(seed, cfg);
    const r = route(s);
    if (!r || r.length !== 2 || s.clamp.par !== 2) return null;
    if (r.some((f) => f.move.pod !== s.clamp.pod || f.cells < 2) || r[1]!.stop === "pod") return null;
    return r.map((f) => f.move);
  }, 2000);

test("tug: the board", async ({ page }) => {
  // A clamp out in the bay, and no two pods side by side, so every shape reads.
  const { seed } = findSeed("tug-hero", (s) => {
    const g = createTugGame(s, cfg);
    const col = g.clamp.cell % W;
    const row = Math.floor(g.clamp.cell / W);
    if (col < 1 || col > W - 2 || row < 1 || row > H - 2) return null;
    return g.pods.every((p) => around(g, p).every((x) => x !== "pod")) ? true : null;
  }, 2000);
  await open(page, seed);
  await hidePointer(page);
  await still(page, "tug", "board", { region: await region(page) });
});

test("tug: a first delivery", async ({ page }) => {
  const { seed, found } = first();
  let s = await open(page, seed);
  await clip(page, "tug", "first-delivery", async () => {
    for (const m of found) s = await swipe(page, s, m);
  }, { tailMs: 1300, region: await region(page) });
});

test("tug: the ghosts", async ({ page }) => {
  // The same round one flick in: the wanted pod's ghosts, and the green ring on the flick that delivers.
  const { seed, found } = first();
  const s = await open(page, seed);
  await key(page, s, found[0]!);
  await hidePointer(page);
  await page.waitForTimeout(500);
  await still(page, "tug", "ghosts", { region: await region(page) });
});

test("tug: parking a stop", async ({ page }) => {
  // Par three, the clamp in the open: one other pod is flicked beside it first, and the cargo stops against that pod.
  const over = { startPar: 3 };
  const { seed, found } = findSeed("tug-park", (seed) => {
    const s = createTugGame(seed, { ...cfg, ...over });
    if (s.clamp.par !== 3 || !inOpen(s)) return null;
    const r = route(s);
    if (!r || r.length !== 3 || r[2]!.stop !== "pod" || r.some((f) => f.cells < 2)) return null;
    return r.filter((f) => f.move.pod !== s.clamp.pod).length === 1 ? r.map((f) => f.move) : null;
  }, 4000);
  let s = await open(page, seed, over);
  await hidePointer(page);
  await still(page, "tug", "open-clamp", { region: await region(page) });
  await clip(page, "tug", "park-a-stop", async () => {
    for (const m of found) s = await swipe(page, s, m);
  }, { tailMs: 1300, region: await region(page) });
});

test("tug: a par four", async ({ page }) => {
  // Par four in the open: the first flick is not the cargo's, two flicks go to other pods, and a pod is the last stop.
  const over = { startPar: 4 };
  const { seed, found } = findSeed("tug-four", (seed) => {
    const s = createTugGame(seed, { ...cfg, ...over });
    if (s.clamp.par !== 4 || !inOpen(s)) return null;
    const r = route(s);
    if (!r || r.length !== 4 || r[3]!.stop !== "pod" || r[0]!.move.pod === s.clamp.pod || r.some((f) => f.cells < 2)) return null;
    return r.filter((f) => f.move.pod !== s.clamp.pod).length === 2 ? r.map((f) => f.move) : null;
  }, 4000);
  let s = await open(page, seed, over);
  await clip(page, "tug", "par-four", async () => {
    for (const m of found) s = await swipe(page, s, m, 450);
  }, { tailMs: 1400, region: await region(page) });
});

test("tug: a streak", async ({ page }) => {
  // Four clean deliveries by key bring the clamps to par four; the clip is the fifth, at a streak of five.
  const { seed, found } = findSeed("tug-streak", (seed) => {
    let s = createTugGame(seed, cfg);
    const before: Flick[] = [];
    for (let n = 0; n < 4; n++) {
      const r = tugSolve(s);
      if (!r) return null;
      for (const m of r) s = reduceTug(s, m);
      before.push(...r);
    }
    const r = route(s);
    if (s.clamp.par !== 4 || !r || r.some((f) => f.cells < 2)) return null;
    return { before, last: r.map((f) => f.move) };
  }, 2000);
  let s = await open(page, seed);
  for (const m of found.before) s = await key(page, s, m);
  await page.waitForTimeout(1500);
  await clip(page, "tug", "streak", async () => {
    for (const m of found.last) s = await swipe(page, s, m, 300);
  }, { tailMs: 1400, region: await region(page) });
});
