import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createFreefallGame, freefallDropValue, freefallEntryLanes, freefallRowSpan, freefallViewString, reduceFreefall, type FreefallDrop, type FreefallState } from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.freefall.config;
const W = cfg.width;
/** The lanes a pod may be dropped down: the top of the tree. */
const [IN_LO, IN_HI] = freefallEntryLanes(cfg);
/** Rows on the board's grid: the rockers and the berths under them. */
const H = cfg.rows + 1;
/** The strip over the shaft, in cells (the renderer's). */
const STRIP = 1.4;

const deal = (seed: string): FreefallState => createFreefallGame(seed, cfg);
const drop = (s: FreefallState, lane: number): FreefallState => reduceFreefall(s, { type: "drop", lane });

/** The drop worth most at once, the leftmost of equals: a plain player's choice. */
function bestDrop(s: FreefallState): number {
  let best = IN_LO;
  let value = -1;
  for (let l = IN_LO; l <= IN_HI; l++) {
    const v = freefallDropValue(s, l).points;
    if (v > value) {
      value = v;
      best = l;
    }
  }
  return best;
}

/** Plain play until some drop of the player's shows the idea: the drops on the way, and the one that shows it. */
function playUntil(seed: string, limit: number, shows: (d: FreefallDrop, rival: FreefallDrop | undefined) => boolean): { log: number[]; lane: number } | null {
  let s = deal(seed);
  const log: number[] = [];
  for (let n = 0; n < limit && !s.finished; n++) {
    for (let l = IN_LO; l <= IN_HI; l++) if (shows(drop(s, l).lastMove!.drops[0]!, drop(s, l).lastMove!.drops[1])) return { log, lane: l };
    const m = bestDrop(s);
    log.push(m);
    s = drop(s, m);
  }
  return null;
}

/** The shaft with its strip, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "freefall");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  const strip = g.cell * STRIP;
  return padded({ x: g.ox, y: g.oy - strip, width: g.cell * W, height: g.cell * H + strip }, pad, await canvasBox(page, "freefall"));
}

/** Rest the pointer over a lane's top, so a clip opens with the hand already there. */
async function hover(page: Page, lane: number): Promise<void> {
  const g = await boardGeom(page, "freefall");
  await page.mouse.move(g.ox + (lane + 0.5) * g.cell, g.oy - g.cell * 0.6, { steps: 4 });
}

async function tapLane(page: Page, lane: number): Promise<void> {
  const g = await boardGeom(page, "freefall");
  await page.mouse.click(g.ox + (lane + 0.5) * g.cell, g.oy - g.cell * 0.6);
}

/** Play drops planned in Node on the page, and check the page ends on the engine's shaft. */
async function replay(page: Page, seed: string, log: readonly number[]): Promise<void> {
  let s = deal(seed);
  for (const lane of log) {
    await tapLane(page, lane);
    s = drop(s, lane);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(s.moveCount));
    await settled(page, "freefall");
    expect(await boardString(page, "freefall")).toBe(freefallViewString(s.config, s.rockers));
  }
}

test("freefall: the board", async ({ page }) => {
  // An opening shaft with no more than one open place, so the brick pattern reads.
  let places = 0;
  for (let r = 0; r < cfg.rows; r++) {
    const [lo, hi] = freefallRowSpan(cfg, r);
    for (let l = lo + (r % 2); l + 1 <= hi; l += 2) places++;
  }
  const { seed } = findSeed("freefall-hero", (s) => (deal(s).rockers.length >= places - 1 ? true : null));
  await openLab(page, "freefall", { seed });
  await hidePointer(page);
  await still(page, "freefall", "board", { region: await region(page) });
});

test("freefall: a pod tips another", async ({ page }) => {
  // Plain play until a drop of the player's tips a resting pod out and brings two pods down.
  const { seed, found } = findSeed("freefall-tip", (s) => playUntil(s, 8, (d) => d.steps.some((st) => st.tossed.length > 0) && d.landed.reduce((n, l) => n + l.ids.length, 0) >= 2 && d.points > 0), 400);
  await openLab(page, "freefall", { seed });
  await replay(page, seed, found.log);
  await hover(page, found.lane);
  await clip(page, "freefall", "tip", async () => {
    await tapLane(page, found.lane);
    await settled(page, "freefall");
  }, { tailMs: 1200, region: await region(page) });
});

test("freefall: a cluster lands", async ({ page }) => {
  // Plain play until a drop of the player's lands a cluster of two or more.
  const { seed, found } = findSeed("freefall-cluster", (s) => playUntil(s, 20, (d) => d.landed.some((l) => l.ids.length >= 2)), 600);
  await openLab(page, "freefall", { seed });
  await replay(page, seed, found.log);
  await hover(page, found.lane);
  await clip(page, "freefall", "cluster", async () => {
    await tapLane(page, found.lane);
    await settled(page, "freefall");
  }, { tailMs: 1200, region: await region(page) });
});

test("freefall: the rival answers", async ({ page }) => {
  // Plain play until a drop of the player's only rests, and the rival's answer tips it out for points.
  const { seed, found } = findSeed("freefall-answer", (s) => playUntil(s, 10, (d, r) => d.points === 0 && r !== undefined && r.points >= 4 && r.steps.some((st) => st.tossed.some((x) => x.id === d.id))), 600);
  await openLab(page, "freefall", { seed });
  await replay(page, seed, found.log);
  await hover(page, found.lane);
  await clip(page, "freefall", "answer", async () => {
    await tapLane(page, found.lane);
    await settled(page, "freefall");
  }, { tailMs: 1400, region: await region(page) });
});
