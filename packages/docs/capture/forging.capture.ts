import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createForgingGame, forgingHint, forgingTargets, forgingViewString, reduceForging, type ForgingState } from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.forging.config;
const W = cfg.width;
const H = cfg.height;
const col = (cell: number): number => cell % W;
const row = (cell: number): number => Math.floor(cell / W);

const deal = (seed: string): ForgingState => createForgingGame(seed, cfg);
const strike = (s: ForgingState, cell: number): ForgingState => reduceForging(s, { type: "strike", cell });

/** The plate with its strip, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "forging");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  const strip = g.cell * 0.95;
  return padded({ x: g.ox, y: g.oy - strip, width: g.cell * W, height: g.cell * H + strip }, pad, await canvasBox(page, "forging"));
}

async function centre(page: Page, cell: number): Promise<[number, number]> {
  const g = await boardGeom(page, "forging");
  return [g.ox + (col(cell) + 0.5) * g.cell, g.oy + (row(cell) + 0.5) * g.cell];
}

/** Tap a spot as a hand would, and wait for the strike to play out. */
async function tapSpot(page: Page, cell: number, wait = 700): Promise<void> {
  const [x, y] = await centre(page, cell);
  await tapAt(page, x, y);
  await page.waitForTimeout(wait);
}

/** Play strikes planned in Node on the page, quickly, and check the page ends on the engine's plate. */
async function replay(page: Page, seed: string, log: readonly number[]): Promise<void> {
  let s = deal(seed);
  for (const cell of log) {
    const [x, y] = await centre(page, cell);
    await page.mouse.click(x, y);
    s = strike(s, cell);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(s.moveCount));
    await settled(page, "forging");
    expect(await boardString(page, "forging")).toBe(forgingViewString(s.cells));
  }
}

/** Four strikes from a fresh plate that make a count, the first anywhere: depth-first over the targets. */
function countPath(s: ForgingState, path: number[]): number[] | null {
  if (path.length === 4) return s.lastMove?.set?.family === "count" ? path : null;
  const options = path.length === 0 ? s.cells.map((_, i) => i).filter((i) => ["one", "two", "three", "four"].includes(s.cells[i]!.mark)) : forgingTargets(s);
  for (const c of options) {
    const next = strike(s, c);
    if (next.lastMove!.stalled || (next.lastMove!.set === null && next.run.length !== path.length + 1)) continue;
    const found = countPath(next, [...path, c]);
    if (found) return found;
  }
  return null;
}

test("forging: the board", async ({ page }) => {
  // A plate that shows every mark but the spark.
  const { seed } = findSeed("forging-hero", (s) => (new Set(deal(s).cells.map((c) => c.mark)).size === 8 ? true : null));
  await openLab(page, "forging", { seed });
  await hidePointer(page);
  await still(page, "forging", "board", { region: await region(page) });
});

test("forging: the first strikes", async ({ page }) => {
  // A step of two near the middle, whose landing spots include another mark worth showing.
  const { seed, found } = findSeed("forging-first", (s) => {
    const g = deal(s);
    const start = 2 * W + 2;
    if (g.cells[start]!.mark !== "two") return null;
    const after = strike(g, start);
    const next = forgingTargets(after).find((c) => ["three", "rail", "hook"].includes(after.cells[c]!.mark));
    return next === undefined ? null : next;
  });
  await openLab(page, "forging", { seed });
  await clip(page, "forging", "first-strikes", async () => {
    await tapSpot(page, 2 * W + 2, 1200);
    await tapSpot(page, found, 900);
  }, { region: await region(page) });
});

test("forging: a count", async ({ page }) => {
  const { seed, found } = findSeed("forging-count", (s) => countPath(deal(s), []), 400);
  await openLab(page, "forging", { seed });
  await clip(page, "forging", "count", async () => {
    for (const c of found) await tapSpot(page, c, 800);
    await settled(page, "forging");
  }, { tailMs: 1200, region: await region(page) });
});

test("forging: a stall", async ({ page }) => {
  // Plain play, the hint's strike each time, until a strike on offer stalls, and ends the round, with a good part of the plate left.
  const { seed, found } = findSeed(
    "forging-stall",
    (s) => {
      let g = deal(s);
      const log: number[] = [];
      for (let n = 0; n < 40; n++) {
        if (n >= 12) {
          const bad = forgingTargets(g).find((c) => strike(g, c).lastMove!.stalled);
          if (bad !== undefined && g.score > 60) return { log, cell: bad };
        }
        const h = forgingHint(g);
        // A stall ends the round, so the line played up to the one shown must never stall.
        if (h === null || strike(g, h).lastMove!.stalled) return null;
        log.push(h);
        g = strike(g, h);
      }
      return null;
    },
    400,
  );
  await openLab(page, "forging", { seed });
  await replay(page, seed, found.log);
  await page.waitForTimeout(400);
  await clip(page, "forging", "stall", async () => {
    await tapSpot(page, found.cell, 1000);
    await settled(page, "forging");
  }, { tailMs: 1200, region: await region(page) });
});
