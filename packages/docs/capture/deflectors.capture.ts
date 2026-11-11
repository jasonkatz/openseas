import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createDeflectorsGame,
  deflectorsBeamPoints,
  deflectorsTrace,
  deflectorsViewString,
  reduceDeflectors,
  type DeflectorsConfig,
  type DeflectorsState,
  type DeflectorsVolley,
} from "@openseas/engine";
import { boardGeom, canvasBox, clip, findSeed, hidePointer, openLab, padded, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.deflectors.config;
const N = cfg.size;
/** Two beams a volley from the first one: the harness's own preset. */
const PAIRS = { rampTicks: 1 };
const pairCfg: DeflectorsConfig = { ...cfg, ...PAIRS };
/** The strip over the grid, in cells: the renderer's own layout. */
const STRIP = 0.8;

/** A round with its first volley announced. Nothing before it depends on the clock, so the page deals the same one. */
function opened(seed: string, config: DeflectorsConfig = cfg): { s: DeflectorsState; v: DeflectorsVolley } | null {
  const s = reduceDeflectors(createDeflectorsGame(seed, config), { type: "wait", tick: config.openingTicks });
  return s.volley ? { s, v: s.volley } : null;
}

/** One setting of the mirrors that sends every beam of the volley home. */
interface Way {
  /** The mirrors to flip to get there from the grid as it stands. */
  flips: number[];
  /** The beams' own points. */
  base: number;
  /** Turns each beam makes. */
  turns: number[];
  /** Some beam meets one mirror on both of its faces. */
  twice: boolean;
}

/** Every setting that sends the whole volley home: the grid is small enough to try them all. */
function ways(s: DeflectorsState, v: DeflectorsVolley): Way[] {
  const cells = s.mirrors.flatMap((m, c) => (m ? [c] : []));
  const out: Way[] = [];
  for (let mask = 0; mask < 1 << cells.length; mask++) {
    const set = s.mirrors.slice();
    const flips = cells.filter((_, i) => mask & (1 << i));
    for (const c of flips) set[c] = 3 - set[c]!;
    const traces = v.beams.map((b) => deflectorsTrace(s.config, set, b.entry));
    if (!traces.every((t, i) => t.out === v.beams[i]!.exit)) continue;
    out.push({
      flips,
      base: traces.reduce((n, t) => n + deflectorsBeamPoints(s.config, t.bounces), 0),
      turns: traces.map((t) => t.bounces),
      twice: traces.some((t) => new Set(t.turns).size < t.turns.length),
    });
  }
  return out;
}

const flip = (s: DeflectorsState, cell: number): DeflectorsState => reduceDeflectors(s, { type: "flip", cell, tick: s.tick });
const view = (s: DeflectorsState): string => deflectorsViewString(s.mirrors, s.volley?.beams ?? []);
/** Beams of the waiting volley that are home as the mirrors stand. */
const home = (s: DeflectorsState): boolean[] => s.volley!.beams.map((b) => deflectorsTrace(s.config, s.mirrors, b.entry).out === b.exit);

// ---- driving the page

/** The grid, its ring of ports and the strip above, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "deflectors");
  return padded({ x: g.ox - g.cell, y: g.oy - g.cell * (1 + STRIP), width: g.cell * (N + 2), height: g.cell * (N + 2 + STRIP) }, 6, await canvasBox(page, "deflectors"));
}

/** Open a lab round and wait for the volley Node planned with. */
async function openOn(page: Page, seed: string, s: DeflectorsState, config?: Record<string, unknown>): Promise<void> {
  await openLab(page, "deflectors", { seed, config });
  await expect(page.getByTestId("deflectors-board")).toHaveAttribute("data-board", view(s));
}

/** Tap a mirror, and wait for the board to hold the grid Node expects. */
async function tapMirror(page: Page, s: DeflectorsState, cell: number): Promise<DeflectorsState> {
  const g = await boardGeom(page, "deflectors");
  await tapAt(page, g.ox + ((cell % N) + 0.5) * g.cell, g.oy + (Math.floor(cell / N) + 0.5) * g.cell);
  const next = flip(s, cell);
  await expect(page.getByTestId("deflectors-board")).toHaveAttribute("data-board", view(next));
  return next;
}

/** Tap the first beam's lit entry port, and wait for the volley to have fired. */
async function fire(page: Page, s: DeflectorsState): Promise<void> {
  const g = await boardGeom(page, "deflectors");
  const port = s.volley!.beams[0]!.entry;
  const at = (port % N) + 0.5;
  const [x, y] = [[at, -0.5], [N + 0.5, at], [at, N + 0.5], [-0.5, at]][Math.floor(port / N)] as [number, number];
  await tapAt(page, g.ox + x * g.cell, g.oy + y * g.cell);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
}

test("deflectors: the board", async ({ page }) => {
  // One beam waiting, astray by a route with a few turns in it, and a long way home to find.
  const { seed, found } = findSeed("deflect-hero", (seed) => {
    const o = opened(seed);
    if (!o || o.v.best < deflectorsBeamPoints(cfg, 8)) return null;
    const now = deflectorsTrace(cfg, o.s.mirrors, o.v.beams[0]!.entry);
    const back = deflectorsTrace(cfg, o.s.mirrors, o.v.beams[0]!.exit);
    return now.bounces >= 3 && back.bounces >= 2 ? o : null;
  });
  await openOn(page, seed, found.s);
  await hidePointer(page);
  await page.waitForTimeout(500);
  await still(page, "deflectors", "board", { region: await region(page) });
});

test("deflectors: joining the lines", async ({ page }) => {
  // The broken line and the dots cross at one mirror, and flipping it brings the beam home.
  const { seed, found } = findSeed("deflect-join", (seed) => {
    const o = opened(seed);
    if (!o) return null;
    const beam = o.v.beams[0]!;
    const now = deflectorsTrace(cfg, o.s.mirrors, beam.entry).turns;
    const back = deflectorsTrace(cfg, o.s.mirrors, beam.exit).turns;
    const one = ways(o.s, o.v).filter((w) => w.flips.length === 1);
    const w = one.find((x) => x.turns[0]! >= 3 && x.turns[0]! <= 5 && now.includes(x.flips[0]!) && back.includes(x.flips[0]!));
    return w && one.length === 1 && now.length >= 2 && back.length >= 2 ? { ...o, cell: w.flips[0]! } : null;
  });
  await openOn(page, seed, found.s);
  await clip(page, "deflectors", "join", async () => {
    await page.waitForTimeout(500);
    const s = await tapMirror(page, found.s, found.cell);
    await page.waitForTimeout(1100);
    await fire(page, s);
  }, { tailMs: 1500, region: await region(page) });
});

test("deflectors: two beams on one grid", async ({ page }) => {
  // One flip brings the first beam home and a second brings the other, on the same setting.
  const { seed, found } = findSeed("deflect-two", (seed) => {
    const o = opened(seed, pairCfg);
    if (!o || o.v.beams.length !== 2) return null;
    if (home(o.s).some(Boolean)) return null;
    for (const w of ways(o.s, o.v)) {
      if (w.flips.length !== 2 || Math.min(...w.turns) < 2) continue;
      for (const [a, b] of [w.flips, [w.flips[1]!, w.flips[0]!]] as [number, number][]) {
        const h = home(flip(o.s, a));
        if (h[0] && !h[1]) return { ...o, a, b };
      }
    }
    return null;
  });
  await openOn(page, seed, found.s, PAIRS);
  await clip(page, "deflectors", "two-beams", async () => {
    await page.waitForTimeout(600);
    let s = await tapMirror(page, found.s, found.a);
    await page.waitForTimeout(1000);
    s = await tapMirror(page, s, found.b);
    await page.waitForTimeout(1000);
    await fire(page, s);
  }, { tailMs: 1500, region: await region(page) });
});

test("deflectors: the long way round", async ({ page }) => {
  // The advanced play. One flip brings the beam home by a short route; a few more send it the
  // longest way there is, through one mirror twice, and the volley is perfect.
  const { seed, found } = findSeed("deflect-long", (seed) => {
    const o = opened(seed);
    if (!o) return null;
    const all = ways(o.s, o.v);
    const short = all.find((w) => w.flips.length === 1 && w.turns[0]! <= 3);
    if (!short) return null;
    const more = (w: Way): number[] => [...w.flips.filter((c) => !short.flips.includes(c)), ...short.flips.filter((c) => !w.flips.includes(c))];
    const long = all
      .filter((w) => w.base === o.v.best && w.twice && w.turns[0]! >= 9 && more(w).length >= 2 && more(w).length <= 3)
      .sort((a, b) => more(a).length - more(b).length)[0];
    return long ? { ...o, first: short.flips[0]!, rest: more(long) } : null;
  });
  await openOn(page, seed, found.s);
  let s = await tapMirror(page, found.s, found.first);
  await hidePointer(page);
  await page.waitForTimeout(500);
  await still(page, "deflectors", "strip", { region: await region(page) });
  await clip(page, "deflectors", "long-way", async () => {
    for (const cell of found.rest) {
      s = await tapMirror(page, s, cell);
      await page.waitForTimeout(650);
    }
    await page.waitForTimeout(700);
    await fire(page, s);
  }, { tailMs: 2200, region: await region(page) });
});

test("deflectors: a perfect pair", async ({ page }) => {
  // The expert play: two beams, both by a long route on one setting, fired perfect.
  const { seed, found } = findSeed("deflect-pair", (seed) => {
    const o = opened(seed, pairCfg);
    if (!o || o.v.beams.length !== 2) return null;
    const w = ways(o.s, o.v)
      .filter((x) => x.base === o.v.best && x.flips.length >= 3 && x.flips.length <= 4 && Math.min(...x.turns) >= 6 && x.twice)
      .sort((a, b) => a.flips.length - b.flips.length)[0];
    return w ? { ...o, flips: w.flips } : null;
  });
  await openOn(page, seed, found.s, PAIRS);
  await clip(page, "deflectors", "perfect-pair", async () => {
    let s = found.s;
    for (const cell of found.flips) {
      s = await tapMirror(page, s, cell);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(700);
    await fire(page, s);
  }, { tailMs: 2200, region: await region(page) });
});
