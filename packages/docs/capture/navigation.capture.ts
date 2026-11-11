import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createNavigationGame, navigationMarkerFilled, reduceNavigation, type Marker, type NavigationState } from "@openseas/engine";
import { boardString, canvasAttr, canvasBox, clip, findSeed, hidePointer, openLab, settled, still, tapAt, type Box } from "./lib.js";

/** A long fall, so a busy machine never lets a star land before the capture brings it down. */
const SLOW = { fallTicks: 150, fallTicksMin: 150 };
const cfg = { ...loadContent().puzzles.navigation.config, ...SLOW };
const O = cfg.octants;

/**
 * Stars fall on the engine's clock, so a capture slows the lab clock to a quarter, lengthens the
 * fall, and brings every star down by hand before it lands by itself. The chart is then a pure function of the turns and
 * drops (the fall's length is all a tick changes), and Node can play the same line ahead of the page.
 */
const SPEED = 0.25;

type Act = { t: "turn"; ring: number; dir: -1 | 1 } | { t: "drop" };
const drop: Act = { t: "drop" };
/** Turn a ring `k` octants: clockwise when positive. */
const turn = (ring: number, k: number): Act[] => Array.from({ length: Math.abs(k) }, () => ({ t: "turn", ring, dir: k > 0 ? 1 : -1 }) as Act);
/** The shorter way round to carry a star `k` octants clockwise. */
const short = (k: number): number => {
  const m = ((k % O) + O) % O;
  return m > O / 2 ? m - O : m;
};

const view = (s: NavigationState): string => s.slots.map((x) => x?.kind ?? -1).join(",");
const step = (s: NavigationState, a: Act): NavigationState =>
  reduceNavigation(s, a.t === "drop" ? { type: "drop", tick: s.tick } : { type: "rotate", ring: a.ring, dir: a.dir, tick: s.tick });
const run = (s: NavigationState, acts: readonly Act[]): NavigationState => acts.reduce(step, s);
const deal = (seed: string): NavigationState => createNavigationGame(seed, cfg);
const marker = (s: NavigationState, ring: number, octant: number): Marker | undefined => s.markers.find((m) => m.ring === ring && m.octant === octant);
/** True when the line cleared no run and lost no heading: nothing happens in the picture but what its caption says. */
const quiet = (s: NavigationState): boolean => s.runsCleared === 0 && s.lostHeadings === 0;

interface Geom {
  cx: number;
  cy: number;
  R: number;
}
async function geom(page: Page): Promise<Geom> {
  const box = await canvasBox(page, "navigation");
  const [gx, gy, R] = (await canvasAttr(page, "navigation", "data-geom")).split(",").map(Number) as [number, number, number];
  return { cx: box.x + gx, cy: box.y + gy, R };
}
/** The chart and the sky over it, without the turn buttons a tall canvas draws below. */
async function region(page: Page): Promise<Box> {
  const box = await canvasBox(page, "navigation");
  const g = await geom(page);
  return { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, g.cy + g.R + 14 - box.y) };
}

/** Do one thing on the page as a player would: tap a ring's right side to turn it clockwise, its left side to turn it back, the center to bring the star down. */
async function act(page: Page, a: Act): Promise<void> {
  const g = await geom(page);
  if (a.t === "drop") {
    await tapAt(page, g.cx, g.cy);
    return;
  }
  const inner = g.R * 0.15;
  const band = (g.R * 0.94 - inner) / cfg.rings;
  const r = inner + (a.ring + 0.5) * band;
  await tapAt(page, g.cx + a.dir * r * Math.cos(0.5), g.cy + r * Math.sin(0.5));
}

/** Play a line on the page, checking after every step that the page's chart is the one Node planned. */
async function play(page: Page, from: NavigationState, acts: readonly Act[], pauseMs = 0): Promise<NavigationState> {
  let s = from;
  for (const a of acts) {
    s = step(s, a);
    await act(page, a);
    await expect.poll(() => boardString(page, "navigation"), { timeout: 10_000, intervals: [40] }).toBe(view(s));
    // Inside a clip a short beat is enough; a setup waits for the chart to come to rest.
    if (pauseMs) await page.waitForTimeout(pauseMs);
    else await settled(page, "navigation", 700);
  }
  return s;
}

async function open(page: Page, seed: string): Promise<NavigationState> {
  await openLab(page, "navigation", { seed, speed: SPEED, config: SLOW });
  const s = deal(seed);
  expect(await boardString(page, "navigation")).toBe(view(s));
  return s;
}

test("navigation: a first star", async ({ page }) => {
  // The first star's own marker is on the inner ring, a few steps round from the top.
  const { seed, found } = findSeed("nav-first", (seed) => {
    const s = deal(seed);
    const m = s.markers.find((x) => x.ring === 0 && x.kind === s.falling.kind && Math.abs(short(x.octant)) >= 2 && Math.abs(short(x.octant)) <= 3);
    return m ? [drop, ...turn(0, short(m.octant))] : null;
  });
  const s = await open(page, seed);
  await clip(page, "navigation", "first-turn", async () => {
    await play(page, s, found, 150);
  }, { tailMs: 1200, region: await region(page) });
});

test("navigation: the slot comes to the top", async ({ page }) => {
  // Two inner markers for the first two stars. The first is filled; the clip brings the second
  // marker's slot to the top, drops, and turns the ring home, so both hold.
  const { seed, found } = findSeed("nav-slot", (seed) => {
    const s = deal(seed);
    const a = s.markers.find((m) => m.ring === 0 && m.octant !== 0 && m.kind === s.falling.kind);
    const b = s.markers.find((m) => m.ring === 0 && m.octant !== 0 && m !== a && m.kind === s.next);
    if (!a || !b || s.markers.length !== 3 || Math.abs(short(b.octant)) < 2) return null;
    const setup = [drop, ...turn(0, short(a.octant))];
    const line = [...turn(0, -short(b.octant)), drop, ...turn(0, short(b.octant))];
    const end = run(s, [...setup, ...line]);
    return end.completed === 0 && quiet(end) && navigationMarkerFilled(end, a) && navigationMarkerFilled(end, b) ? { setup, line } : null;
  });
  let s = await open(page, seed);
  s = await play(page, s, found.setup);
  await page.waitForTimeout(500);
  await clip(page, "navigation", "slot", async () => {
    await play(page, s, found.line, 150);
  }, { tailMs: 1200, region: await region(page) });
});

test("navigation: a star with nothing under it slides in", async ({ page }) => {
  const { seed, found } = findSeed("nav-slide", (seed) => {
    const s = deal(seed);
    const setup = [drop, drop];
    const line = turn(1, 1);
    const end = run(s, [...setup, ...line]);
    // Two unlike stars, no marker in the way of either, so the only thing that happens is the slide.
    const clear = [marker(s, 0, 0), marker(s, 1, 0), marker(s, 0, 1), marker(s, 1, 1)].every((m) => !m);
    return clear && s.falling.kind !== s.next && end.completed === 0 && quiet(end) ? { setup, line } : null;
  });
  let s = await open(page, seed);
  s = await play(page, s, found.setup);
  await page.waitForTimeout(500);
  await clip(page, "navigation", "slide", async () => {
    await play(page, s, found.line, 100);
  }, { leadMs: 900, tailMs: 1400, region: await region(page) });
});

test("navigation: the board, and a floor", async ({ page }) => {
  // Eight stars laid round the inner ring, then a ninth lands on the middle ring and is carried
  // straight to its marker: with a full ring under it, it has a star to stand on all the way.
  const { seed, found } = findSeed("nav-floor", (seed) => {
    let s = deal(seed);
    const setup: Act[] = [];
    for (let i = 0; i < O; i++) setup.push(...(i ? turn(0, 1) : []), drop);
    s = run(s, setup);
    if (s.completed !== 0 || !quiet(s) || s.slots.slice(0, O).some((x) => !x)) return null;
    const m = s.markers.find((x) => x.ring === 1 && x.kind === s.falling.kind && Math.abs(short(x.octant)) >= 3);
    if (!m) return null;
    const line = [drop, ...turn(1, short(m.octant))];
    const end = run(s, line);
    return end.completed === 0 && quiet(end) && navigationMarkerFilled(end, m) ? { setup, line } : null;
  });
  let s = await open(page, seed);
  // The hero: a round a few stars in.
  s = await play(page, s, found.setup.slice(0, 9));
  await hidePointer(page);
  await page.waitForTimeout(700);
  await still(page, "navigation", "board", { region: await region(page) });
  s = await play(page, s, found.setup.slice(9));
  await page.waitForTimeout(500);
  await clip(page, "navigation", "floor", async () => {
    await play(page, s, found.line, 120);
  }, { tailMs: 1200, region: await region(page) });
});

test("navigation: walking a star on two feet", async ({ page }) => {
  // Three stars, three landings, one constellation: two inner markers side by side and a middle
  // marker over the leading one. The third star lands on the middle ring at the top, standing on
  // the second, and is walked round: middle ring a step, inner ring a step, never over a hole.
  const { seed, found } = findSeed("nav-walk", (seed) => {
    const s = deal(seed);
    const top = s.markers.find((m) => m.ring === 1 && m.octant >= 2 && m.octant <= 3);
    if (!top || s.markers.length !== 3) return null;
    const o = top.octant;
    if (marker(s, 0, o)?.kind !== s.falling.kind || marker(s, 0, o - 1)?.kind !== s.next) return null;
    const setup = [drop, ...turn(0, 1), drop];
    const walk: Act[] = [drop, ...turn(1, 1)];
    for (let i = 1; i < o; i++) walk.push(...turn(0, 1), ...turn(1, 1));
    const end = run(s, [...setup, ...walk]);
    return end.completed === 1 && end.landings === 3 && quiet(end) ? { setup, walk } : null;
  }, 3_000_000);
  let s = await open(page, seed);
  s = await play(page, s, found.setup);
  await page.waitForTimeout(500);
  await clip(page, "navigation", "walk", async () => {
    await play(page, s, found.walk, 150);
  }, { tailMs: 1800, region: await region(page) });
});

test("navigation: three stars, three landings", async ({ page }) => {
  // Every marker on the inner ring and the first three stars are theirs: no star is wasted, and
  // the constellation pays its swift charting bonus in full.
  const { seed, found } = findSeed("nav-swift", (seed) => {
    const s0 = deal(seed);
    if (s0.markers.length !== 3 || s0.markers.some((m) => m.ring !== 0)) return null;
    let s = s0;
    const line: Act[] = [];
    for (let i = 0; i < 3; i++) {
      const kind = s.falling.kind;
      const m = s0.markers.find((x) => x.kind === kind && !navigationMarkerFilled(s, x));
      if (!m) return null;
      const acts = [...turn(0, -short(m.octant)), drop, ...turn(0, short(m.octant))];
      line.push(...acts);
      s = run(s, acts);
    }
    return s.completed === 1 && s.landings === 3 && quiet(s) && line.length <= 9 ? line : null;
  }, 200_000);
  const s = await open(page, seed);
  await clip(page, "navigation", "swift", async () => {
    await play(page, s, found, 100);
  }, { tailMs: 1800, region: await region(page) });
});
