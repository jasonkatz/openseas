import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createOverloadGame, overloadChainSize, overloadViewString, reduceOverload, type OverloadState } from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.overload.config;
const W = cfg.width;
const H = cfg.height;
const N = W * H;
/** The strip over the bank (the taps held, the chain, the streak), in cells: the renderer's own layout. */
const STRIP = 0.95;

const deal = (seed: string): OverloadState => createOverloadGame(seed, cfg);
/** A tap in Node. The bank is a pure function of the taps: the clock only brings taps back. */
const tap = (s: OverloadState, cell: number): OverloadState => reduceOverload(s, { type: "tap", cell, tick: s.tick });

interface Chain {
  cell: number;
  size: number;
  waves: number;
  /** Every capacitor that burst. */
  bursts: number[];
  boosted: number;
}

/** What a tap on `cell` sets off, or null when it only charges. */
function chainOf(s: OverloadState, cell: number): Chain | null {
  if (overloadChainSize(s, cell) === 0) return null;
  const ev = tap(s, cell).lastMove!.events.find((e) => e.type === "chain");
  if (!ev || ev.type !== "chain") return null;
  return { cell, size: ev.size, waves: ev.waves.length, bursts: ev.waves.flatMap((w) => [...w.bursts]), boosted: ev.waves.reduce((n, w) => n + w.boosted.length, 0) };
}

/** The tap that sets off the longest chain. */
function best(s: OverloadState): Chain | null {
  let out: Chain | null = null;
  for (let c = 0; c < N; c++) {
    const size = overloadChainSize(s, c);
    if (size > (out?.size ?? 0)) out = chainOf(s, c);
  }
  return out;
}

/** The one charge that makes the longest chain on the tap after it: where to charge, and that chain. */
function bestCharge(s: OverloadState): { charge: number; then: Chain } | null {
  let out: { charge: number; then: Chain } | null = null;
  for (let p = 0; p < N; p++) {
    if (s.cells[p]!.charge >= 3) continue;
    const then = best(tap(s, p));
    if (then && then.size > (out?.then.size ?? 0)) out = { charge: p, then };
  }
  return out;
}

const boosters = (s: OverloadState): number => s.cells.filter((c) => c.booster).length;
const threes = (s: OverloadState): number => s.cells.filter((c) => c.charge === 3).length;
/** Not on the bank's rim, so the whole chain is in the picture's middle. */
const inner = (cell: number): boolean => cell % W > 0 && cell % W < W - 1 && Math.floor(cell / W) > 0 && Math.floor(cell / W) < H - 1;

// ---- driving the page

/** The bank and the strip over it, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "overload");
  const top = g.oy - g.cell * STRIP;
  return padded({ x: g.ox, y: top, width: g.cell * W, height: g.cell * H + g.cell * STRIP }, 10, await canvasBox(page, "overload"));
}

/** Tap a capacitor with the pointer and keep the Node state in step. */
async function tapCell(page: Page, s: OverloadState, cell: number): Promise<OverloadState> {
  const g = await boardGeom(page, "overload");
  await tapAt(page, g.ox + ((cell % W) + 0.5) * g.cell, g.oy + (Math.floor(cell / W) + 0.5) * g.cell);
  return tap(s, cell);
}

/** Wait for the chain to play out, and hold the page to the bank Node expects. */
async function landed(page: Page, s: OverloadState): Promise<void> {
  await expect.poll(() => boardString(page, "overload")).toBe(overloadViewString(s.cells));
  await settled(page, "overload");
}

test("overload: the board", async ({ page }) => {
  // An opening with a booster on it and a few capacitors at three.
  const { seed } = findSeed("over-hero", (s) => {
    const g = deal(s);
    return boosters(g) === 2 && threes(g) >= 5 && (best(g)?.size ?? 0) >= 4 ? true : null;
  });
  await openLab(page, "overload", { seed, paused: true });
  await hidePointer(page);
  await still(page, "overload", "board", { region: await region(page) });
});

test("overload: a first burst", async ({ page }) => {
  // One tap on a capacitor at three, and its one neighbour at three goes in the next wave. No booster.
  const { seed, found } = findSeed("over-first", (s) => {
    const g = deal(s);
    for (let c = 0; c < N; c++) {
      const ch = inner(c) ? chainOf(g, c) : null;
      if (ch && ch.size === 3 && ch.waves >= 2 && ch.boosted === 0) return ch;
    }
    return null;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await clip(page, "overload", "first-burst", async () => {
    s = await tapCell(page, s, found.cell);
    await landed(page, s);
  }, { leadMs: 900, tailMs: 1500, region: await region(page) });
});

test("overload: reading a chain", async ({ page }) => {
  // A chain of six or seven from one tap, over three waves or more, with no booster in it.
  const { seed, found } = findSeed("over-read", (s) => {
    const ch = best(deal(s));
    return ch && ch.size >= 6 && ch.size <= 7 && ch.waves >= 3 && ch.boosted === 0 ? ch : null;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await still(page, "overload", "read-before", { region: await region(page) });
  await clip(page, "overload", "read", async () => {
    s = await tapCell(page, s, found.cell);
    await landed(page, s);
  }, { leadMs: 1200, tailMs: 1500, region: await region(page) });
});

test("overload: charge first", async ({ page }) => {
  // No tap reaches the streak's four. One charge, and the next tap sets off six or more.
  const { seed, found } = findSeed("over-charge", (s) => {
    const g = deal(s);
    if ((best(g)?.size ?? 0) >= cfg.streakMin - 1) return null;
    const plan = bestCharge(g);
    return plan && plan.then.size >= 6 && plan.then.size <= 8 && plan.then.boosted === 0 && plan.then.cell !== plan.charge ? plan : null;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await clip(page, "overload", "charge-first", async () => {
    s = await tapCell(page, s, found.charge);
    await landed(page, s);
    await page.waitForTimeout(700);
    s = await tapCell(page, s, found.then.cell);
    await landed(page, s);
  }, { leadMs: 900, tailMs: 1500, region: await region(page) });
});

test("overload: the join", async ({ page }) => {
  // Two clusters with one capacitor between them: the best tap is four to six, and one charge on
  // the capacitor between makes it twelve or more.
  const { seed, found } = findSeed("over-join", (s) => {
    const g = deal(s);
    const now = best(g);
    if (!now || now.size < 4 || now.size > 6) return null;
    const plan = bestCharge(g);
    if (!plan || plan.then.size < 12 || plan.then.size < now.size * 2 || plan.then.boosted > 0) return null;
    // The charged capacitor is the bridge: it bursts in the chain but is not the one tapped.
    return plan.then.cell !== plan.charge && plan.then.bursts.includes(plan.charge) ? plan : null;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await clip(page, "overload", "join", async () => {
    s = await tapCell(page, s, found.charge);
    await landed(page, s);
    await page.waitForTimeout(800);
    s = await tapCell(page, s, found.then.cell);
    await landed(page, s);
  }, { leadMs: 1200, tailMs: 1800, region: await region(page) });
});

test("overload: a booster", async ({ page }) => {
  // A chain of eight or more with a booster in it, that would be half as long or less were the
  // booster a plain capacitor: the two charges it passes are what carry it.
  const { seed, found } = findSeed("over-boost", (s) => {
    const g = deal(s);
    const ch = best(g);
    if (!ch || ch.size < 8 || ch.boosted !== 1 || ch.bursts[0] === undefined) return null;
    const plain: OverloadState = { ...g, cells: g.cells.map((c) => ({ ...c, booster: false })) };
    return overloadChainSize(plain, ch.cell) * 2 <= ch.size ? ch : null;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await clip(page, "overload", "booster", async () => {
    s = await tapCell(page, s, found.cell);
    await landed(page, s);
  }, { leadMs: 1200, tailMs: 1800, region: await region(page) });
});

test("overload: a streak at pace", async ({ page }) => {
  // Four chains of four or more from four taps in a row, each the longest on the bank, none
  // needing a charge. Every chain gives its tap back, so the hand ends as full as it began.
  const { seed, found } = findSeed("over-tempo", (s) => {
    let g = deal(s);
    const line: number[] = [];
    for (let n = 0; n < 4; n++) {
      const ch = best(g);
      if (!ch || ch.size < cfg.streakMin || ch.size > 9) return null;
      line.push(ch.cell);
      g = tap(g, ch.cell);
    }
    return line;
  });
  let s = deal(seed);
  await openLab(page, "overload", { seed });
  await clip(page, "overload", "tempo", async () => {
    for (const cell of found) {
      s = await tapCell(page, s, cell);
      await landed(page, s);
      await page.waitForTimeout(150);
    }
  }, { leadMs: 500, tailMs: 1300, region: await region(page) });
});
