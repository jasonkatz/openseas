import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  TRACTOR_CACHE,
  createTractorGame,
  reduceTractor,
  tractorSwapIllegalReason,
  tractorSwapValue,
  tractorViewString,
  type TractorMoveReport,
  type TractorState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.tractor.config;
const W = cfg.width;
const H = cfg.height;
const col = (cell: number): number => cell % W;
const row = (cell: number): number => Math.floor(cell / W);

const deal = (seed: string): TractorState => createTractorGame(seed, cfg);
const swap = (s: TractorState, cell: number): TractorState => reduceTractor(s, { type: "swap", cell });
const cachesOf = (s: TractorState): number[] => s.cells.flatMap((p, i) => (p.kind === TRACTOR_CACHE ? [i] : []));
/** Every legal swap on the field. */
const swaps = (s: TractorState): number[] => s.cells.flatMap((_, c) => (tractorSwapIllegalReason(s, c) === null ? [c] : []));

/** The swap worth most at once, as the strip would show it: a plain player's choice. */
function bestSwap(s: TractorState): number {
  let best = -1;
  let value = -1;
  for (const c of swaps(s)) {
    const v = tractorSwapValue(s, c).points;
    if (v > value) {
      value = v;
      best = c;
    }
  }
  return best;
}

/**
 * Plain play, the swap worth most at once each time, until some swap on the field shows the idea:
 * the swaps on the way, and the one that shows it.
 */
function playUntil(seed: string, limit: number, shows: (r: TractorMoveReport, s: TractorState) => boolean): { log: number[]; cell: number } | null {
  let s = deal(seed);
  const log: number[] = [];
  for (let n = 0; n < limit; n++) {
    for (const c of swaps(s)) if (shows(swap(s, c).lastMove!, s)) return { log, cell: c };
    const m = bestSwap(s);
    if (m < 0 || !tractorSwapValue(s, m).scores) return null;
    log.push(m);
    s = swap(s, m);
  }
  return null;
}

/** The field with its strip and frame, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "tractor");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  const strip = g.cell * 0.95;
  return padded({ x: g.ox, y: g.oy - strip, width: g.cell * W, height: g.cell * H + strip }, pad, await canvasBox(page, "tractor"));
}

const centre = (g: { ox: number; oy: number; cell: number }, c: number): [number, number] => [g.ox + (col(c) + 0.5) * g.cell, g.oy + (row(c) + 0.5) * g.cell];

/** Rest the pointer beside the piece a swap starts from, so a clip opens with the hand already there. */
async function hover(page: Page, cell: number): Promise<void> {
  const g = await boardGeom(page, "tractor");
  const [x, y] = centre(g, cell);
  await page.mouse.move(x - g.cell * 0.3, y - g.cell * 0.3, { steps: 4 });
}

/** Drag the piece at `cell` down onto the one under it, over `ms`. */
async function dragDown(page: Page, cell: number, ms = 320): Promise<void> {
  const g = await boardGeom(page, "tractor");
  const [x, y] = centre(g, cell);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(Math.min(90, ms / 3));
  const steps = Math.max(2, Math.round(ms / 16));
  await page.mouse.move(x, y + g.cell * 0.8, { steps });
  await page.mouse.up();
}

/** Play swaps planned in Node on the page, quickly, and check the page ends on the engine's field. */
async function replay(page: Page, seed: string, log: readonly number[]): Promise<void> {
  let s = deal(seed);
  for (const cell of log) {
    await dragDown(page, cell, 40);
    s = swap(s, cell);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(s.moveCount));
    await settled(page, "tractor");
    expect(await boardString(page, "tractor")).toBe(tractorViewString(s.cells));
  }
}

test("tractor: the board", async ({ page }) => {
  // One cache low in the field, away from the edges, with loot over it to clear.
  const { seed } = findSeed("tractor-hero", (s) => {
    const [cache] = cachesOf(deal(s));
    if (cache === undefined) return null;
    return row(cache) >= H - 3 && col(cache) >= 1 && col(cache) <= W - 2 ? true : null;
  });
  await openLab(page, "tractor", { seed });
  await hidePointer(page);
  await still(page, "tractor", "board", { region: await region(page) });
});

test("tractor: a first run", async ({ page }) => {
  // A swap on the opening that makes one run of three, low in the field, and sets off nothing more.
  const { seed, found } = findSeed("tractor-first", (s) => {
    const g = deal(s);
    for (const c of swaps(g)) {
      const r = swap(g, c).lastMove!;
      if (r.waves.length === 1 && r.waves[0]!.runs.length === 1 && r.waves[0]!.runs[0]!.cells.length === 3 && row(c) >= 3 && r.caches.length === 0) return c;
    }
    return null;
  });
  await openLab(page, "tractor", { seed });
  await hover(page, found);
  await clip(page, "tractor", "first-run", async () => {
    await dragDown(page, found);
    await settled(page, "tractor");
  }, { region: await region(page) });
});

test("tractor: a run lifts a cache", async ({ page }) => {
  // A run straight down the column above a cache: it rises three rows in one swap.
  const { seed, found } = findSeed("tractor-lift", (s) => {
    const g = deal(s);
    const [cache] = cachesOf(g);
    if (cache === undefined) return null;
    for (const c of swaps(g)) {
      const r = swap(g, c).lastMove!;
      const first = r.waves[0];
      if (!first || r.waves.length !== 1 || first.runs.length !== 1) continue;
      const cells = first.runs[0]!.cells;
      if (cells.length === 3 && cells.every((x) => col(x) === col(cache) && row(x) < row(cache))) return c;
    }
    return null;
  });
  await openLab(page, "tractor", { seed });
  await hover(page, found);
  await clip(page, "tractor", "lift", async () => {
    await dragDown(page, found);
    await settled(page, "tractor");
  }, { tailMs: 1100, region: await region(page) });
});

test("tractor: two caches at once", async ({ page }) => {
  // Plain play until a swap brings two caches aboard together.
  const { seed, found } = findSeed("tractor-pair", (s) => playUntil(s, 40, (r) => r.caches.length >= 2), 400);
  await openLab(page, "tractor", { seed });
  await replay(page, seed, found.log);
  await hover(page, found.cell);
  await clip(page, "tractor", "two-caches", async () => {
    await dragDown(page, found.cell);
    await settled(page, "tractor");
  }, { tailMs: 1400, region: await region(page) });
});

test("tractor: a beacon fires", async ({ page }) => {
  // Plain play until a swap fires a cross beacon whose lines take a cache.
  const { seed, found } = findSeed(
    "tractor-beacon",
    (s) => playUntil(s, 45, (r) => r.waves[0]?.fired[0]?.mark === "cross" && r.waves[0].caches.length > 0),
    400,
  );
  await openLab(page, "tractor", { seed });
  await replay(page, seed, found.log);
  await hover(page, found.cell);
  await clip(page, "tractor", "beacon", async () => {
    await dragDown(page, found.cell);
    await settled(page, "tractor");
  }, { tailMs: 1400, region: await region(page) });
});
