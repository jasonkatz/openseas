import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createReactorGame,
  reactorHotCount,
  reactorIsHot,
  reactorLaneCells,
  reactorLegalDirs,
  reactorPortLoad,
  reactorPortStatus,
  reactorSwipeOutcome,
  reactorViewString,
  reduceReactor,
  type ReactorDir,
  type ReactorPort,
  type ReactorState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.reactor.config;
const N = cfg.size;
const KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"] as const;
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
/** A lab round long enough that the clock never ends it while a line is played in. */
const SECONDS = 900;

const deal = (seed: string): ReactorState => createReactorGame(seed, cfg);
const sw = (s: ReactorState, dir: ReactorDir): ReactorState => reduceReactor(s, { type: "swipe", dir });
const rods = (s: ReactorState): number => s.cells.filter((r) => r).length;
const has = (s: ReactorState, grade: number): number => s.cells.filter((r) => r?.grade === grade).length;
const hot = (s: ReactorState): number => reactorHotCount(cfg, s.cells);
const cellOf = (s: ReactorState, id: number): number => s.cells.findIndex((r) => r?.id === id);
const inLane = (port: ReactorPort, cell: number): boolean => reactorLaneCells(cfg, port.side, port.lane).includes(cell);

// ---- a player to plan with

/** How good a core looks to the planner: room, rods on their way up, hot rods and how many stand ready at a port. */
function worth(s: ReactorState, stack: boolean): number {
  let v = s.score + 8 * (N * N - rods(s)) + 4 * has(s, 2) + 14 * has(s, 3);
  let ready = 0;
  for (const p of s.ports) {
    ready += reactorPortLoad(s, p);
    if (reactorPortStatus(s, p) === "blocked") v += 10;
  }
  const h = hot(s);
  v += h * 40 + ready * 30 - (h >= cfg.criticalHot - 1 ? 60 : 0);
  if (stack && ready >= 2) v += 150;
  return v;
}

function look(s: ReactorState, depth: number, stack: boolean): number {
  if (depth === 0) return worth(s, stack);
  let best = -Infinity;
  for (const d of reactorLegalDirs(s)) {
    const n = sw(s, d);
    best = Math.max(best, n.scrams > s.scrams ? n.score - 250 : look(n, depth - 1, stack));
  }
  return best === -Infinity ? worth(s, stack) : best;
}

/**
 * The swipe a planner three deep makes. With `stack` it will not send one hot rod out alone while it
 * is safe to hold it: it parks the rod at its port and brings another in behind, for the salvo.
 */
function plan(s: ReactorState, stack: boolean): ReactorDir {
  let best = reactorLegalDirs(s)[0]!;
  let top = -Infinity;
  for (const d of reactorLegalDirs(s)) {
    const n = sw(s, d);
    let v = n.scrams > s.scrams ? n.score - 250 : look(n, 2, stack);
    if (stack && n.lastMove!.discharges.length === 1 && hot(s) < cfg.criticalHot - 1) v -= 220;
    if (v > top) {
      top = v;
      best = d;
    }
  }
  return best;
}

interface Line {
  /** `states[k]` is the core before swipe `dirs[k]`. */
  states: ReactorState[];
  dirs: ReactorDir[];
}

function lineOf(seed: string, swipes: number, stack = false): Line {
  const states = [deal(seed)];
  const dirs: ReactorDir[] = [];
  for (let k = 0; k < swipes; k++) {
    const s = states[k]!;
    const d = plan(s, stack);
    dirs.push(d);
    states.push(sw(s, d));
  }
  return { states, dirs };
}

/** A stretch of a planned line to show: play `dirs` up to `from` off camera, then swipes `from` to `to` by hand. */
interface Shot {
  line: Line;
  from: number;
  to: number;
}

// ---- driving the page

/** The core's panel: the strip over it (next rod, heat lamps), the core, the pipeline bar under it. The renderer's own layout. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "reactor");
  const rim = Math.max(7, g.cell * 0.16);
  const pad = rim + Math.max(4, g.cell * 0.06);
  const strip = g.cell * 0.72;
  const bar = g.cell * 0.5;
  const panel = { x: g.ox - pad, y: g.oy - strip - pad * 0.4, width: g.cell * N + pad * 2, height: g.cell * N + strip + bar + pad * 1.4 };
  return padded(panel, 8, await canvasBox(page, "reactor"));
}

/** Hold the page to the core Node expects, with every rod landed. */
async function landed(page: Page, s: ReactorState): Promise<void> {
  await expect(page.getByTestId("hud-moves")).toHaveText(String(s.moveCount));
  await expect.poll(() => boardString(page, "reactor")).toBe(reactorViewString(s.cells, s.ports));
  await settled(page, "reactor");
}

/** Play the start of a line by key, off camera. */
async function playIn(page: Page, line: Line, upTo: number): Promise<void> {
  for (let k = 0; k < upTo; k++) {
    await page.keyboard.press(KEYS[line.dirs[k]!]!);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(k + 1));
  }
  await landed(page, line.states[upTo]!);
}

/** Move the mouse from one point to another in `ms` by the clock, however slow each step is. */
async function sweep(page: Page, from: readonly [number, number], to: readonly [number, number], ms: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - t0) / ms);
    await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    if (t >= 1) return;
  }
}

let hand: readonly [number, number] | null = null;
/** The core's middle and cell size, read once a shot: nothing on the page is asked for while a clip records. */
let core: { x: number; y: number; cell: number } | null = null;

/** Swipe the core with the pointer: press near the middle and drag a cell that way. */
async function swipeHand(page: Page, dir: ReactorDir): Promise<void> {
  const c = core!;
  const [dx, dy] = STEPS[dir]!;
  const from = [c.x - dx * c.cell * 0.6, c.y - dy * c.cell * 0.6] as const;
  const to = [c.x + dx * c.cell * 0.6, c.y + dy * c.cell * 0.6] as const;
  await sweep(page, hand ?? [c.x, c.y], from, 220);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await sweep(page, from, to, 240);
  await page.waitForTimeout(80);
  await page.mouse.up();
  hand = to;
}

/** Open the shot's seed, play in to where it starts and rest the pointer on the core. */
async function setUp(page: Page, seed: string, shot: Shot): Promise<void> {
  await openLab(page, "reactor", { seed, seconds: SECONDS });
  await playIn(page, shot.line, shot.from);
  const g = await boardGeom(page, "reactor");
  core = { x: g.ox + (N / 2) * g.cell, y: g.oy + (N / 2) * g.cell, cell: g.cell };
  hand = [core.x, core.y];
  await page.mouse.move(core.x, core.y);
}

/**
 * Record the shot's swipes, by hand, a beat apart. The beat is by the clock, so a busy machine does
 * not stretch the clip; the page is held to Node's core once the recording is over.
 */
async function film(page: Page, name: string, shot: Shot, beatMs: number, leadMs = 700, tailMs = 1400): Promise<void> {
  const box = await region(page);
  await clip(page, "reactor", name, async () => {
    for (let k = shot.from; k <= shot.to; k++) {
      await swipeHand(page, shot.line.dirs[k]!);
      if (k < shot.to) await page.waitForTimeout(beatMs);
    }
  }, { leadMs, tailMs, region: box });
  await landed(page, shot.line.states[shot.to + 1]!);
}

test("reactor: the board", async ({ page }) => {
  // A core in the middle of a round: every grade on it, one hot rod with its port ready, a pipeline running.
  const { seed, found } = findSeed("reactor-hero", (s) => {
    const line = lineOf(s, 60);
    for (let k = 20; k < 60; k++) {
      const g = line.states[k]!;
      const ready = g.ports.filter((p) => reactorPortStatus(g, p) === "ready").length;
      if (hot(g) === 1 && ready === 1 && has(g, 1) >= 2 && has(g, 2) >= 2 && has(g, 3) >= 1 && rods(g) >= 7 && rods(g) <= 9 && g.combo >= 2) return { line, from: k, to: k };
    }
    return null;
  });
  await setUp(page, seed, found);
  await hidePointer(page);
  await page.waitForTimeout(400);
  await still(page, "reactor", "board", { region: await region(page) });
});

test("reactor: a swipe fuses", async ({ page }) => {
  // The opening two grade I rods fuse on the first swipe, and the third swipe fuses again.
  const { seed, found } = findSeed("reactor-fuse", (s) => {
    const g = deal(s);
    for (const a of reactorLegalDirs(g)) {
      if (reactorSwipeOutcome(g, a).fusions !== 1) continue;
      const g1 = sw(g, a);
      for (const b of reactorLegalDirs(g1)) {
        if (b === a) continue;
        const g2 = sw(g1, b);
        for (const c of reactorLegalDirs(g2)) {
          if (c === b || reactorSwipeOutcome(g2, c).fusions !== 1) continue;
          return { line: { states: [g, g1, g2, sw(g2, c)], dirs: [a, b, c] }, from: 0, to: 2 };
        }
      }
    }
    return null;
  });
  await setUp(page, seed, found);
  await film(page, "fuse", found, 650);
});

test("reactor: a hot rod out through its port", async ({ page }) => {
  // The round's first hot rod: one swipe fuses two grade IIIs into it, the next pushes it out. Nothing else hot.
  const { seed, found } = findSeed("reactor-out", (s) => {
    const line = lineOf(s, 24);
    for (let k = 1; k < 24; k++) {
      const out = line.states[k + 1]!.lastMove!.discharges;
      if (out.length === 0) continue;
      const made = line.states[k]!.lastMove!.fusions.filter((f) => f.hot).length;
      return out.length === 1 && made === 1 && hot(line.states[k - 1]!) === 0 && line.dirs[k] !== line.dirs[k - 1] ? { line, from: k - 1, to: k } : null;
    }
    return null;
  });
  await setUp(page, seed, found);
  await film(page, "discharge", found, 900);
});

test("reactor: reading the gates", async ({ page }) => {
  // Two hot rods and two ports: one gate ready (chevrons), the other blocked (a bar).
  const { seed, found } = findSeed("reactor-gates", (s) => {
    const line = lineOf(s, 60, true);
    for (let k = 10; k < 60; k++) {
      const g = line.states[k]!;
      const st = g.ports.map((p) => reactorPortStatus(g, p));
      if (hot(g) === 2 && st.includes("ready") && st.includes("blocked") && rods(g) <= 9) return { line, from: k, to: k };
    }
    return null;
  });
  await setUp(page, seed, found);
  await hidePointer(page);
  await page.waitForTimeout(400);
  await still(page, "reactor", "gates", { region: await region(page) });
});

test("reactor: a port on an inner lane", async ({ page }) => {
  // One hot rod and a port on an inner lane. A sideways swipe stops the rod against another rod, in
  // the port's lane; the next swipe sends it out.
  const { seed, found } = findSeed("reactor-inner", (s) => {
    const line = lineOf(s, 60);
    for (let k = 1; k < 60; k++) {
      const out = line.states[k + 1]!.lastMove!.discharges;
      if (out.length !== 1) continue;
      const port = out[0]!.port;
      const before = line.states[k - 1]!;
      const at = cellOf(before, out[0]!.id);
      if (port.lane === 0 || port.lane === N - 1 || at < 0 || hot(before) !== 1) continue;
      if (inLane(port, at) || line.dirs[k - 1]! % 2 === port.side % 2) continue;
      return { line, from: k - 1, to: k };
    }
    return null;
  });
  await setUp(page, seed, found);
  await film(page, "inner", found, 950);
});

test("reactor: the pipeline", async ({ page }) => {
  // A run already going: a discharge, then the next one three or four swipes later, well inside the window.
  const { seed, found } = findSeed("reactor-pipe", (s) => {
    const line = lineOf(s, 70);
    for (let k = 10; k < 66; k++) {
      const a = line.states[k + 1]!.lastMove!.discharges;
      if (a.length !== 1 || a[0]!.pipeline < 2) continue;
      for (let j = k + 3; j <= k + 4; j++) {
        const b = line.states[j + 1]!.lastMove!.discharges;
        const between = line.states.slice(k + 2, j + 1).some((g) => g.lastMove!.discharges.length > 0);
        if (b.length === 1 && !between) return { line, from: k, to: j };
      }
    }
    return null;
  });
  await setUp(page, seed, found);
  await film(page, "pipeline", found, 520);
});

test("reactor: a salvo", async ({ page }) => {
  // One hot rod parked at its port. Two swipes bring a second in behind it, and the third sends both.
  const { seed, found } = findSeed("reactor-salvo", (s) => {
    const line = lineOf(s, 70, true);
    for (let k = 3; k < 70; k++) {
      const out = line.states[k + 1]!.lastMove!.discharges;
      if (out.length !== 2 || out[0]!.port.lane !== out[1]!.port.lane) continue;
      const port = out[0]!.port;
      const parked = line.states[k - 2]!;
      const open = parked.ports.some((p) => p.side === port.side && p.lane === port.lane);
      if (!open || reactorPortLoad(parked, port) !== 1 || reactorPortLoad(line.states[k]!, port) !== 2) continue;
      if (line.states.slice(k - 1, k + 1).some((g) => g.lastMove!.discharges.length > 0)) continue;
      if (parked.cells.some((r) => r && reactorIsHot(cfg, r.grade) && !inLane(port, cellOf(parked, r.id)))) continue;
      return { line, from: k - 2, to: k };
    }
    return null;
  });
  await setUp(page, seed, found);
  await film(page, "salvo", found, 800);
});
