import { expect, type Page, test } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  REFINING_CATALYST,
  REFINING_OIL,
  REFINING_VAPOUR,
  createRefiningGame,
  reduceRefining,
  refiningDrawValue,
  refiningLinks,
  refiningPartner,
  refiningViewString,
  type RefiningDir,
  type RefiningState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.refining.config;
const W = cfg.width;
const H = cfg.height;
/** The strip over the tower (the outlet's lamp and its grade), in cells, and the honeycomb's column spacing: the renderer's own layout. */
const STRIP = 0.95;
const DX = 0.88;

interface Swap {
  cell: number;
  dir: RefiningDir;
}

const deal = (seed: string): RefiningState => createRefiningGame(seed, cfg);
/** A swap in Node, at the tick the round stands on: the capture holds the clock still. */
const swap = (s: RefiningState, m: Swap): RefiningState => reduceRefining(s, { type: "swap", cell: m.cell, dir: m.dir, tick: s.tick });
const swaps = (s: RefiningState): Swap[] => refiningLinks(s);

/** The shortest run of at most `depth` swaps that makes the outlet `grade`, searched breadth first. */
function reach(s: RefiningState, grade: "clear" | "dump", depth: number): Swap[] | null {
  let frontier: Array<{ s: RefiningState; path: Swap[] }> = [{ s, path: [] }];
  for (let d = 0; d <= depth; d++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      if (refiningDrawValue(f.s).grade === grade) return f.path;
      if (d < depth) for (const m of swaps(f.s)) next.push({ s: swap(f.s, m), path: [...f.path, m] });
    }
    frontier = next.slice(0, 4000);
  }
  return null;
}

/** The tower and the strip over it, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "refining");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  return padded({ x: g.ox, y: g.oy - g.cell * STRIP, width: g.cell * (1 + (W - 1) * DX), height: g.cell * (H + 0.5 + STRIP) }, pad, await canvasBox(page, "refining"));
}

/** A cell's centre on the page: every other column sits half a piece low, as the canvas's `data-phase` says. */
async function centre(page: Page, c: number): Promise<[number, number]> {
  const g = await boardGeom(page, "refining");
  const phase = Number(await page.getByTestId("refining-canvas").getAttribute("data-phase"));
  const col = c % W;
  const low = ((col + phase) & 1) === 1;
  return [g.ox + (0.5 + col * DX) * g.cell, g.oy + (Math.floor(c / W) + 0.5 + (low ? 0.5 : 0)) * g.cell];
}

/** Drag the piece at a swap's first cell onto its partner, over `ms`. */
async function drag(page: Page, s: RefiningState, m: Swap, ms = 320): Promise<void> {
  const [x, y] = await centre(page, m.cell);
  const [tx, ty] = await centre(page, refiningPartner(s, m.cell, m.dir)!);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(Math.min(90, ms / 3));
  const steps = Math.max(2, Math.round(ms / 16));
  await page.mouse.move(tx, ty, { steps });
  await page.mouse.up();
}

async function hover(page: Page, cell: number): Promise<void> {
  const g = await boardGeom(page, "refining");
  const [x, y] = await centre(page, cell);
  await page.mouse.move(x - g.cell * 0.3, y - g.cell * 0.3, { steps: 4 });
}

/** Tap the outlet's lamp: an early draw. */
async function tapLamp(page: Page): Promise<void> {
  const g = await boardGeom(page, "refining");
  const x = g.ox + (0.5 + (W - 1) * DX) * g.cell;
  const y = g.oy - g.cell * STRIP * 0.5;
  await page.mouse.move(x - g.cell * 0.4, y + g.cell * 0.2, { steps: 6 });
  await page.waitForTimeout(160);
  await page.mouse.click(x, y);
}

/** Play swaps planned in Node on the page, quickly, and hold the page to the engine's tower. */
async function replay(page: Page, s: RefiningState, path: readonly Swap[]): Promise<RefiningState> {
  let at = s;
  for (const m of path) {
    await drag(page, at, m, 40);
    at = swap(at, m);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(at.moveCount));
    await settled(page, "refining");
    expect(await boardString(page, "refining")).toBe(refiningViewString(at.cells));
  }
  return at;
}

const counts = (s: RefiningState, kind: number): number => s.cells.filter((p) => p.kind === kind).length;

test("refining: the board", async ({ page }) => {
  // A tower with one catalyst and a fair spread of all three fractions.
  const { seed } = findSeed("refining-hero", (s) => {
    const g = deal(s);
    return counts(g, REFINING_CATALYST) === 1 && counts(g, REFINING_OIL) >= 7 && swaps(g).length >= 12 ? true : null;
  });
  await openLab(page, "refining", { seed, paused: true });
  await hidePointer(page);
  await still(page, "refining", "board", { region: await region(page) });
});

test("refining: a swap", async ({ page }) => {
  // A vapour that moves right past the oil beside it.
  const { seed, found } = findSeed("refining-swap", (s) => {
    const g = deal(s);
    const m = swaps(g).find((x) => x.dir !== "down" && g.cells[x.cell]!.kind === REFINING_VAPOUR && x.cell % W >= 1 && x.cell % W <= W - 3);
    return m ?? null;
  });
  await openLab(page, "refining", { seed, paused: true });
  await hover(page, found.cell);
  await clip(page, "refining", "swap", async () => {
    await drag(page, deal(seed), found);
    await settled(page, "refining");
  }, { region: await region(page) });
});

test("refining: a clear column drawn early", async ({ page }) => {
  // Two or three swaps make the outlet clear; the clip is the last swap and the draw.
  const { seed, found } = findSeed("refining-clear", (s) => {
    const path = reach(deal(s), "clear", 3);
    return path && path.length >= 2 ? path : null;
  }, 400);
  await openLab(page, "refining", { seed, paused: true });
  const before = await replay(page, deal(seed), found.slice(0, -1));
  const last = found[found.length - 1]!;
  await hover(page, last.cell);
  await clip(page, "refining", "clear", async () => {
    await drag(page, before, last);
    await settled(page, "refining");
    await page.waitForTimeout(300);
    await tapLamp(page);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(before.moveCount + 2));
    await settled(page, "refining");
  }, { tailMs: 1300, region: await region(page) });
});

test("refining: a dump", async ({ page }) => {
  // An outlet of oil and tar, or one swap from it, drawn early to the sump.
  const { seed, found } = findSeed("refining-dump", (s) => reach(deal(s), "dump", 1), 2000);
  await openLab(page, "refining", { seed, paused: true });
  const before = await replay(page, deal(seed), found);
  await clip(page, "refining", "dump", async () => {
    await tapLamp(page);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(before.moveCount + 1));
    await settled(page, "refining");
  }, { tailMs: 1200, region: await region(page) });
});
