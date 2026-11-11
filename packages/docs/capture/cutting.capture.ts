import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createCuttingGame,
  cuttingBestCut,
  cuttingBestRemaining,
  cuttingCutPreview,
  cuttingPureOre,
  cuttingViewString,
  reduceCutting,
  type CuttingPiece,
  type CuttingRect,
  type CuttingState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.cutting.config;
const W = cfg.width;
const H = cfg.height;
/** The strip over the slab (cuts left, banked of best, the next-slab chip), in cells: the renderer's own layout. */
const STRIP = 1.05;

interface Cut {
  piece: number;
  vertical: boolean;
  at: number;
}

const deal = (seed: string): CuttingState => createCuttingGame(seed, cfg);
const make = (s: CuttingState, c: Cut): CuttingState => reduceCutting(s, { type: "cut", ...c });
/** What a cut banks at once. */
const pays = (s: CuttingState, c: Cut): number => cuttingCutPreview(s, c.piece, c.vertical, c.at)?.points ?? 0;
const pieceOf = (s: CuttingState, c: Cut): CuttingPiece => s.pieces.find((p) => p.id === c.piece)!;

/** Every cut the table allows. */
function cuts(s: CuttingState): Cut[] {
  const out: Cut[] = [];
  for (const p of s.pieces) {
    for (let at = p.x + 1; at < p.x + p.w; at++) out.push({ piece: p.id, vertical: true, at });
    for (let at = p.y + 1; at < p.y + p.h; at++) out.push({ piece: p.id, vertical: false, at });
  }
  return out;
}

/** Whether the slab's best is still in reach after this cut. */
function keepsBest(s: CuttingState, c: Cut): boolean {
  const a = make(s, c);
  if (a.slab !== s.slab) return a.lastMove!.slab!.grade === "flawless";
  return a.slabGot + cuttingBestRemaining(a) === s.slabBest;
}

/** The cut that banks most now: what a player who takes what is on offer makes. */
function greedy(s: CuttingState): Cut {
  return cuts(s)
    .map((c) => ({ c, p: pays(s, c) }))
    .sort((a, b) => b.p - a.p)[0]!.c;
}

/** The biggest rectangle of one ore on a fresh slab. */
function biggest(s: CuttingState): CuttingRect & { area: number } {
  let out = { x: 0, y: 0, w: 0, h: 0, area: 0 };
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      for (let w = 1; x + w <= W; w++)
        for (let h = 1; y + h <= H; h++) if (w * h > out.area && cuttingPureOre(s, { x, y, w, h }) !== null) out = { x, y, w, h, area: w * h };
  return out;
}

const crosses = (c: Cut, r: CuttingRect): boolean => (c.vertical ? c.at > r.x && c.at < r.x + r.w : c.at > r.y && c.at < r.y + r.h);

/** A best plan for the slab on the table, cut by cut, with the report that ended it. */
function plan(s: CuttingState): { line: Cut[]; pays: number[]; end: NonNullable<NonNullable<CuttingState["lastMove"]>["slab"]> } {
  const line: Cut[] = [];
  const paid: number[] = [];
  let t = s;
  for (;;) {
    const c = cuttingBestCut(t)!;
    line.push(c);
    paid.push(pays(t, c));
    t = make(t, c);
    if (t.slab !== s.slab) return { line, pays: paid, end: t.lastMove!.slab! };
  }
}

// ---- driving the page

/** The slab and the strip over it, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "cutting");
  return padded({ x: g.ox, y: g.oy - g.cell * STRIP, width: g.cell * W, height: g.cell * (H + STRIP) }, Math.ceil(g.cell * 0.12) + 6, await canvasBox(page, "cutting"));
}

const pointer = new WeakMap<Page, [number, number]>();

/** Move the pointer there over `ms` of real time, however slow the machine is: the travel is paced by the clock. */
async function sweep(page: Page, x: number, y: number, ms: number): Promise<void> {
  const [x0, y0] = pointer.get(page) ?? [x - 60, y - 40];
  const t0 = Date.now();
  for (;;) {
    const f = Math.min(1, (Date.now() - t0) / ms);
    await page.mouse.move(x0 + (x - x0) * f, y0 + (y - y0) * f);
    if (f >= 1) break;
  }
  pointer.set(page, [x, y]);
}

type Geom = Awaited<ReturnType<typeof boardGeom>>;

/** The two ends of a swipe along a cut's line, just inside the piece. */
function ends(g: Geom, s: CuttingState, c: Cut): [[number, number], [number, number]] {
  const p = pieceOf(s, c);
  const px = (x: number): number => g.ox + x * g.cell;
  const py = (y: number): number => g.oy + y * g.cell;
  return c.vertical ? [[px(c.at), py(p.y + 0.2)], [px(c.at), py(p.y + p.h - 0.2)]] : [[px(p.x + 0.2), py(c.at)], [px(p.x + p.w - 0.2), py(c.at)]];
}

/**
 * Swipe along a cut's line and let go, holding `holdMs` on the lined-up cut so its preview is seen.
 * Nothing here waits on the page, so a clip runs at the hand's pace on a busy machine; `landed`
 * holds the page to the Node state afterwards.
 */
async function swipe(page: Page, g: Geom, s: CuttingState, c: Cut, holdMs: number): Promise<CuttingState> {
  const [a, b] = ends(g, s, c);
  await sweep(page, a[0], a[1], 220);
  await page.mouse.down();
  await sweep(page, b[0], b[1], 360);
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  return make(s, c);
}

/** Wait for the page to show the table Node expects, with every animation landed. */
async function landed(page: Page, s: CuttingState): Promise<void> {
  await expect.poll(() => boardString(page, "cutting")).toBe(cuttingViewString(s.ores, W, s.pieces));
  await settled(page, "cutting");
}

/** Tap near a cut's line: the first tap lines the cut up and shows what each side would do. */
async function lineUp(page: Page, s: CuttingState, c: Cut): Promise<void> {
  const g = await boardGeom(page, "cutting");
  const p = pieceOf(s, c);
  // On the line, and in the middle of a cell the other way, so the nearest line is this one.
  const x = c.vertical ? g.ox + c.at * g.cell : g.ox + (p.x + Math.floor(p.w / 2) + 0.5) * g.cell;
  const y = c.vertical ? g.oy + (p.y + Math.floor(p.h / 2) + 0.5) * g.cell : g.oy + c.at * g.cell;
  await sweep(page, x, y, 200);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await expect(page.getByTestId("cutting-canvas")).toHaveAttribute("data-cursor", `${c.piece},${c.vertical ? 1 : 0},${c.at}`);
}

/** Open a lab round and hold the page to the slab Node dealt. */
async function open(page: Page, seed: string): Promise<CuttingState> {
  const s = deal(seed);
  await openLab(page, "cutting", { seed });
  expect(await boardString(page, "cutting")).toBe(cuttingViewString(s.ores, W, s.pieces));
  return s;
}

test("cutting: the board", async ({ page }) => {
  // A first slab with a big block on it and four cuts.
  const { seed } = findSeed("cut-hero", (s) => {
    const g = deal(s);
    return g.cutsAllowed === 4 && biggest(g).area >= 12 ? true : null;
  });
  await open(page, seed);
  await hidePointer(page);
  await still(page, "cutting", "board", { region: await region(page) });
});

test("cutting: a first cut", async ({ page }) => {
  // One swipe on a fresh slab that banks a pure side of eight cells or more, and is the first cut of a best plan.
  const { seed, found } = findSeed("cut-first", (s) => {
    const g = deal(s);
    const c = cuttingBestCut(g);
    if (!c) return null;
    const halves = cuttingCutPreview(g, c.piece, c.vertical, c.at)!.halves;
    return halves.filter((h) => h.ore !== null).length === 1 && halves.some((h) => h.ore !== null && h.w * h.h >= 8) ? c : null;
  });
  let s = await open(page, seed);
  const g = await boardGeom(page, "cutting");
  await clip(page, "cutting", "first-cut", async () => {
    s = await swipe(page, g, s, found, 900);
  }, { leadMs: 600, tailMs: 1500, region: await region(page) });
  await landed(page, s);
});

test("cutting: lining a cut up", async ({ page }) => {
  // A cut lined up by a tap: one side would bank and is lit with what it pays, the other is mixed and dimmed.
  const { seed, found } = findSeed("cut-preview", (s) => {
    const g = deal(s);
    for (const c of cuts(g)) {
      const halves = cuttingCutPreview(g, c.piece, c.vertical, c.at)!.halves;
      const pure = halves.filter((h) => h.ore !== null);
      if (pure.length === 1 && pure[0]!.w * pure[0]!.h >= 6 && pure[0]!.w * pure[0]!.h <= 12 && keepsBest(g, c)) return c;
    }
    return null;
  });
  const s = await open(page, seed);
  await lineUp(page, s, found);
  await page.waitForTimeout(250);
  await still(page, "cutting", "preview", { region: await region(page) });
});

/**
 * A three-cut slab where taking what is on offer goes wrong: the cut that banks most now runs
 * through the biggest block, and every first cut that keeps the best in reach banks nothing.
 */
function trap(seed: string): { tempting: Cut; line: Cut[] } | null {
  const g = deal(seed);
  if (g.cutsAllowed !== 3) return null;
  const big = biggest(g);
  if (big.area < 9) return null;
  const tempting = greedy(g);
  const now = pays(g, tempting);
  if (now === 0 || now * 4 > big.area * big.area || !crosses(tempting, big)) return null;
  if (cuts(g).some((c) => pays(g, c) > 0 && keepsBest(g, c))) return null;
  const p = plan(g);
  return p.pays[0] === 0 && p.pays[1]! > 0 && p.end.grade === "flawless" ? { tempting, line: p.line } : null;
}

test("cutting: the cut that tempts and the cut that sets up", async ({ page }) => {
  const { seed, found } = findSeed("cut-setup", trap);
  let s = await open(page, seed);
  await lineUp(page, s, found.tempting);
  await page.waitForTimeout(250);
  await still(page, "cutting", "through", { region: await region(page) });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cutting-canvas")).toHaveAttribute("data-cursor", "");
  const g = await boardGeom(page, "cutting");
  const before = s;
  await clip(page, "cutting", "setup", async () => {
    for (const c of found.line) {
      s = await swipe(page, g, s, c, 450);
      await page.waitForTimeout(650);
    }
  }, { leadMs: 500, tailMs: 500, region: await region(page) });
  expect(s.slab).toBe(before.slab + 1);
  await landed(page, s);
});

test("cutting: choosing the scrap", async ({ page }) => {
  // A slab of seven blocks and two flaws, as the fifth slab on is: the best plan spends all of its
  // cuts, banks no piece smaller than four cells and leaves a quarter of the slab or more as scrap.
  const { seed, found } = findSeed("cut-budget", (s) => {
    let g = deal(s);
    while (g.slab < 4) g = reduceCutting(g, { type: "done" });
    if (g.cutsAllowed !== 4) return null;
    const p = plan(g);
    let t = g;
    let small = false;
    for (const c of p.line) {
      const halves = cuttingCutPreview(t, c.piece, c.vertical, c.at)!.halves;
      if (halves.some((h) => h.ore !== null && h.w * h.h < 4)) small = true;
      t = make(t, c);
    }
    const scrap = p.end.scrap.reduce((n, r) => n + r.w * r.h, 0);
    return !small && p.line.length === 4 && p.end.grade === "flawless" && scrap >= 9 ? p.line : null;
  });
  let s = await open(page, seed);
  // Give the first four slabs up, off camera, to reach a slab as busy as they get.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("d");
    s = reduceCutting(s, { type: "done" });
    await expect(page.getByTestId("cutting-board")).toHaveAttribute("data-slab", String(s.slab));
  }
  await expect.poll(() => boardString(page, "cutting")).toBe(cuttingViewString(s.ores, W, s.pieces));
  await settled(page, "cutting");
  await page.waitForTimeout(1200);
  const g = await boardGeom(page, "cutting");
  await clip(page, "cutting", "budget", async () => {
    for (const c of found) {
      s = await swipe(page, g, s, c, 350);
      await page.waitForTimeout(600);
    }
  }, { leadMs: 600, tailMs: 500, region: await region(page) });
  await landed(page, s);
});

test("cutting: a second flawless slab", async ({ page }) => {
  // Two three-cut slabs in a row. The first is cut off camera on its best plan; the clip is the
  // second, flawless again, so its bonus is paid at the second step of the streak.
  const { seed } = findSeed("cut-streak", (s) => {
    const g = deal(s);
    if (g.cutsAllowed !== 3) return null;
    let t = g;
    for (const c of plan(g).line) t = make(t, c);
    return t.cutsAllowed === 3 && plan(t).line.length === 3 && plan(t).pays.every((p) => p > 0) ? true : null;
  });
  let s = await open(page, seed);
  const g = await boardGeom(page, "cutting");
  for (const c of plan(s).line) {
    s = await swipe(page, g, s, c, 60);
    await landed(page, s);
  }
  await page.waitForTimeout(1500);
  const line = plan(s).line;
  await clip(page, "cutting", "streak", async () => {
    for (const c of line) {
      s = await swipe(page, g, s, c, 150);
      await page.waitForTimeout(450);
    }
  }, { leadMs: 400, tailMs: 600, region: await region(page) });
  await landed(page, s);
});
