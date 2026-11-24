import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_SLASH,
  createDeflectorsGame,
  deflectorsIsMirror,
  deflectorsOutlook,
  deflectorsRecipeSize,
  deflectorsViewString,
  type DeflectorsConfig,
  type DeflectorsState,
} from "@openseas/engine";
import { boardGeom, canvasBox, clip, findSeed, hidePointer, openLab, padded, still, type Box } from "./lib.js";

const cfg: DeflectorsConfig = loadContent().puzzles.deflectors.config;
const N = cfg.size;
/** The strip over the grid, the ring of ports and recipes round it, and the queue under it, in cells: the renderer's own layout. */
const STRIP = 0.7;
const RING = 1.36;
const QUEUE = 1.3;

/** The grid as text, without the targets or the queue: what a placement changes. */
const gridOf = (s: DeflectorsState): string => deflectorsViewString(s.mirrors, [], []).split("|")[0]!;

/** The next piece put on `cell`, turned first when `turn`: the grid it leaves. */
function placed(s: DeflectorsState, cell: number, turn: boolean): DeflectorsState {
  const piece = s.queue[0]!;
  const way = turn ? (piece === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH) : piece;
  const mirrors = s.mirrors.slice();
  mirrors[cell] = way;
  return { ...s, mirrors, queue: s.queue.slice(1) };
}

/** Every place the first piece can go, either way for a mirror, with the shot it leaves. */
function placements(s: DeflectorsState): Array<{ cell: number; turn: boolean; after: DeflectorsState }> {
  const out: Array<{ cell: number; turn: boolean; after: DeflectorsState }> = [];
  const piece = s.queue[0]!;
  for (let cell = 0; cell < s.mirrors.length; cell++) for (const turn of deflectorsIsMirror(piece) ? [false, true] : [false]) out.push({ cell, turn, after: placed(s, cell, turn) });
  return out;
}

// ---- driving the page

/** The strip, the grid with its ring, and the queue, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "deflectors");
  return padded({ x: g.ox - g.cell * RING, y: g.oy - g.cell * (RING + STRIP), width: g.cell * (N + RING * 2), height: g.cell * (N + RING * 2 + STRIP + QUEUE) }, 6, await canvasBox(page, "deflectors"));
}

/** Open a lab round and wait for the grid Node planned with. */
async function openOn(page: Page, seed: string, s: DeflectorsState): Promise<void> {
  await openLab(page, "deflectors", { seed });
  await expect.poll(async () => ((await page.getByTestId("deflectors-board").getAttribute("data-board")) ?? "").split("|")[0]).toBe(gridOf(s));
}

/** Where the pointer was left, so the next tap's travel starts there. */
let hand: [number, number] = [640, 300];

/**
 * Move the pointer there over `ms` of real time and press. Each step waits for the page, so the
 * steps are as many as the machine has time for and the travel is never slower than `ms`.
 */
async function tap(page: Page, x: number, y: number, ms = 320): Promise<void> {
  const [fx, fy] = hand;
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = 1 - (1 - k) ** 2;
    await page.mouse.move(fx + (x - fx) * e, fy + (y - fy) * e);
    if (k >= 1) break;
  }
  hand = [x, y];
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/** Turn the next piece if asked, put it on `cell`, and wait for the board to hold the grid Node expects. */
async function place(page: Page, s: DeflectorsState, cell: number, turn: boolean): Promise<void> {
  const g = await boardGeom(page, "deflectors");
  if (turn) {
    await tap(page, g.ox + (N * g.cell) / 2 - g.cell * 1.2, g.oy + g.cell * (N + RING + QUEUE / 2));
    await page.waitForTimeout(350);
  }
  await tap(page, g.ox + ((cell % N) + 0.5) * g.cell, g.oy + (Math.floor(cell / N) + 0.5) * g.cell);
  const want = gridOf(placed(s, cell, turn));
  await expect.poll(async () => ((await page.getByTestId("deflectors-board").getAttribute("data-board")) ?? "").split("|")[0]).toBe(want);
}

/** Tap the emitters, and wait for the shot to have fired. */
async function fire(page: Page): Promise<void> {
  const g = await boardGeom(page, "deflectors");
  await tap(page, g.ox - 0.5 * g.cell, g.oy + (N / 2 + 0.5) * g.cell);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
}

test("deflectors: the board", async ({ page }) => {
  // A grid that already lights one target through a lens, with recipes on the others.
  const { seed, found } = findSeed("deflect-hero", (seed) => {
    const s = createDeflectorsGame(seed, cfg);
    const o = deflectorsOutlook(s);
    const lit = o.shots.find((x) => x.target >= 0);
    if (o.lit !== 1 || !lit || lit.bounces < 2) return null;
    const target = s.targets.find((t) => t.id === lit.target)!;
    return deflectorsRecipeSize(target.recipe) >= 1 && s.targets.filter((t) => deflectorsRecipeSize(t.recipe) === 2).length >= 1 ? s : null;
  });
  await openOn(page, seed, found);
  await hidePointer(page);
  await page.waitForTimeout(500);
  await still(page, "deflectors", "board", { region: await region(page) });
});

test("deflectors: lighting a target", async ({ page }) => {
  // Nothing lit; one mirror put down sends a beam round into a target, and the shot is fired.
  const { seed, found } = findSeed("deflect-light", (seed) => {
    const s = createDeflectorsGame(seed, cfg);
    if (!deflectorsIsMirror(s.queue[0]!) || deflectorsOutlook(s).lit > 0) return null;
    const p = placements(s).find((x) => {
      const o = deflectorsOutlook(x.after);
      return o.lit === 1 && x.turn && s.mirrors[x.cell] === 0 && o.shots.some((sh) => sh.target >= 0 && sh.bounces >= 3);
    });
    return p ? { s, p } : null;
  });
  await openOn(page, seed, found.s);
  await clip(page, "deflectors", "light", async () => {
    await place(page, found.s, found.p.cell, found.p.turn);
    await page.waitForTimeout(900);
    await fire(page);
  }, { tailMs: 1600, region: await region(page) });
});

test("deflectors: two at once", async ({ page }) => {
  // One target lit; one mirror put down lights a second, and the shot pays double.
  const { seed, found } = findSeed("deflect-double", (seed) => {
    const s = createDeflectorsGame(seed, cfg);
    if (!deflectorsIsMirror(s.queue[0]!) || deflectorsOutlook(s).lit !== 1) return null;
    const p = placements(s).find((x) => deflectorsOutlook(x.after).lit === 2 && s.mirrors[x.cell] === 0);
    return p ? { s, p } : null;
  });
  await openOn(page, seed, found.s);
  await clip(page, "deflectors", "double", async () => {
    await place(page, found.s, found.p.cell, found.p.turn);
    await page.waitForTimeout(1000);
    await fire(page);
  }, { tailMs: 2200, region: await region(page) });
});

test("deflectors: the queue and the bin", async ({ page }) => {
  // The queue as a round opens: the bin, the next piece, the pieces after it, and the count left.
  const { seed, found } = findSeed("deflect-queue", (seed) => {
    const s = createDeflectorsGame(seed, cfg);
    return deflectorsOutlook(s).lit === 0 && deflectorsIsMirror(s.queue[0]!) && s.queue.some((q) => !deflectorsIsMirror(q)) ? s : null;
  });
  await openOn(page, seed, found);
  await hidePointer(page);
  await page.waitForTimeout(500);
  await still(page, "deflectors", "queue", { region: await region(page) });
});
