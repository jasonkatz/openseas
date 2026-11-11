import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createScannerGame,
  reduceScanner,
  scannerClearCells,
  scannerContactsLeft,
  scannerDistance,
  scannerPingCandidates,
  scannerProvenCells,
  scannerSafePing,
  scannerViewString,
  type ScannerState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasAttr, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.scanner.config;
const W = cfg.width;
const H = cfg.height;
/** The strip over the sector and the switch under it, in cells: the renderer's own layout. */
const STRIP = 0.62;
const SWITCH = 1.22;
/** Long enough for any capture's lead-in on a busy machine: moves are untimed, so the clock only has to not run out. */
const SECONDS = 600;

interface Move {
  type: "ping" | "lock";
  cell: number;
}

const deal = (seed: string): ScannerState => createScannerGame(seed, cfg);
const play = (s: ScannerState, m: Move): ScannerState => reduceScanner(s, m);
const replay = (seed: string, line: readonly Move[]): ScannerState => line.reduce(play, deal(seed));
const steps = (a: number, b: number): number => scannerDistance(cfg, a, b);
/** Not on the sector's rim. */
const inner = (cell: number): boolean => cell % W > 0 && cell % W < W - 1 && Math.floor(cell / W) > 0 && Math.floor(cell / W) < H - 1;

interface Ring {
  /** The ping's cell. */
  cell: number;
  /** The fog cells left on its ring. */
  cands: number[];
}

/** Every ping with two or more cells left on its ring, the shortest ring first. */
const openRings = (s: ScannerState): Ring[] =>
  s.pings
    .map((p) => ({ cell: p.cell, cands: scannerPingCandidates(s, p) }))
    .filter((r) => r.cands.length >= 2)
    .sort((a, b) => a.cands.length - b.cands.length);

/** Shaded cells not yet pinged: where a ping is safe. */
function safeCells(s: ScannerState): number[] {
  const clear = scannerClearCells(s);
  const pinged = new Set(s.pings.map((p) => p.cell));
  return clear.flatMap((c, i) => (c && !pinged.has(i) ? [i] : []));
}

/** How many different step counts `from` is from a ring's cells: a ping there tells that many groups apart. */
const tells = (from: number, cands: readonly number[]): number => new Set(cands.map((c) => steps(from, c))).size;

/**
 * The aimed ping the guide teaches: the shaded cell that tells apart the most candidates over every
 * open ring, and of those the one nearest the shortest ring.
 */
function aimed(s: ScannerState): number {
  const rings = openRings(s);
  let best = scannerSafePing(s)!;
  if (rings.length === 0) return best;
  let bestTells = -1;
  let bestNear = Infinity;
  for (const c of safeCells(s)) {
    const t = rings.reduce((n, r) => n + tells(c, r.cands) - 1, 0);
    const near = rings[0]!.cands.reduce((n, x) => n + steps(c, x), 0);
    if (t > bestTells || (t === bestTells && near < bestNear)) {
      best = c;
      bestTells = t;
      bestNear = near;
    }
  }
  return best;
}

/** A careful player's next move: lock what a ring proves, else the aimed ping. */
function next(s: ScannerState): Move {
  const proven = scannerProvenCells(s);
  return proven.length > 0 ? { type: "lock", cell: proven[0]! } : { type: "ping", cell: aimed(s) };
}

/** Play the first sector with `next` and stop at the first position `want` takes: the moves that reach it, and what it found. */
function walk<T>(seed: string, want: (s: ScannerState, line: readonly Move[]) => T | null): { line: Move[]; at: T } | null {
  let s = deal(seed);
  const line: Move[] = [];
  while (s.sectorsCleared === 0 && line.length < 40) {
    const at = want(s, line);
    if (at !== null) return { line, at };
    const m = next(s);
    line.push(m);
    s = play(s, m);
  }
  return null;
}

// ---- driving the page

/** The sector with its strip and its switch, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "scanner");
  return padded({ x: g.ox, y: g.oy - g.cell * STRIP, width: g.cell * W, height: g.cell * (H + STRIP + SWITCH) }, 12, await canvasBox(page, "scanner"));
}

async function point(page: Page, cell: number): Promise<[number, number]> {
  const g = await boardGeom(page, "scanner");
  return [g.ox + ((cell % W) + 0.5) * g.cell, g.oy + (Math.floor(cell / W) + 0.5) * g.cell];
}

let hand: [number, number] | null = null;

/** Move the pointer there over `ms` of the wall clock, however slow the machine is: a busy run must not stretch a clip. */
async function go(page: Page, x: number, y: number, ms = 340): Promise<void> {
  const from = hand ?? [x, y + 60];
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = k * k * (3 - 2 * k);
    await page.mouse.move(from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e);
    if (k >= 1) break;
  }
  hand = [x, y];
}

async function tap(page: Page, cell: number): Promise<void> {
  await go(page, ...(await point(page, cell)));
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** The board shows exactly what Node holds, and every animation has landed. */
async function landed(page: Page, s: ScannerState): Promise<void> {
  await expect.poll(() => boardString(page, "scanner"), { timeout: 15_000 }).toBe(scannerViewString(s));
  await settled(page, "scanner");
}

/** Ping a cell with a tap (the switch is on ping) and keep Node in step. */
async function ping(page: Page, s: ScannerState, cell: number): Promise<ScannerState> {
  await tap(page, cell);
  const out = play(s, { type: "ping", cell });
  await landed(page, out);
  return out;
}

/** Tap a ping to light its ring. */
async function light(page: Page, cell: number): Promise<void> {
  await tap(page, cell);
  await expect.poll(() => canvasAttr(page, "scanner", "data-ring")).toMatch(new RegExp(`^${cell}:`));
}

/** Lock a cell with a long press: hold until the board answers. Returns as soon as it has; `landed` waits for the rest. */
async function hold(page: Page, s: ScannerState, cell: number): Promise<ScannerState> {
  const before = await boardString(page, "scanner");
  await go(page, ...(await point(page, cell)));
  await page.mouse.down();
  await expect.poll(() => boardString(page, "scanner"), { timeout: 15_000, intervals: [60] }).not.toBe(before);
  await page.mouse.up();
  return play(s, { type: "lock", cell });
}

/** Play a line before the picture starts. */
async function lead(page: Page, seed: string, line: readonly Move[]): Promise<ScannerState> {
  let s = deal(seed);
  for (const m of line) {
    s = m.type === "ping" ? await ping(page, s, m.cell) : await hold(page, s, m.cell);
    await landed(page, s);
  }
  return s;
}

async function open(page: Page, seed: string): Promise<void> {
  hand = null;
  await openLab(page, "scanner", { seed, seconds: SECONDS });
  await settled(page, "scanner");
}

test("scanner: the board, and a lit ring", async ({ page }) => {
  // An opening ping near the middle that hears a contact three steps off, with most of its ring still in fog.
  const mid = (cell: number): boolean => inner(cell) && cell % W >= 2 && cell % W <= W - 3;
  const { seed } = findSeed("scan-hero", (s) => {
    const g = deal(s);
    const o = g.pings[0]!;
    return mid(o.cell) && o.distance === 3 && scannerPingCandidates(g, o).length >= 6 ? true : null;
  });
  await open(page, seed);
  await hidePointer(page);
  await still(page, "scanner", "board", { region: await region(page) });
  await light(page, deal(seed).pings[0]!.cell);
  await hidePointer(page);
  await page.waitForTimeout(400);
  await still(page, "scanner", "ring", { region: await region(page) });
});

test("scanner: a ping, its ring, a lock", async ({ page }) => {
  // One ping on a shaded cell answers 2 and has a single fog cell on its ring: the contact is proven.
  const { seed, found } = findSeed("scan-first", (s) => {
    const g = deal(s);
    if (scannerProvenCells(g).length > 0) return null;
    for (const c of safeCells(g)) {
      if (!inner(c)) continue;
      const g1 = play(g, { type: "ping", cell: c });
      const p = g1.pings[g1.pings.length - 1]!;
      const cands = scannerPingCandidates(g1, p);
      if (p.distance === 2 && cands.length === 1 && scannerPingCandidates(g1, g1.pings[0]!).length >= 3) return { ping: c, lock: cands[0]! };
    }
    return null;
  });
  await open(page, seed);
  let s = deal(seed);
  await clip(page, "scanner", "first-lock", async () => {
    s = await ping(page, s, found.ping);
    await page.waitForTimeout(500);
    await light(page, found.ping);
    await page.waitForTimeout(900);
    s = await hold(page, s, found.lock);
    await landed(page, s);
  }, { leadMs: 700, tailMs: 1300, region: await region(page) });
});

test("scanner: an aimed ping", async ({ page }) => {
  // A ring with two cells left. The idle hint's ping is the same number of steps from both and would
  // settle nothing; the aimed ping is nearer one of them, and its answer proves which.
  const { seed, found } = findSeed("scan-aim", (seed) =>
    walk(seed, (s, line) => {
      if (line.length > 4 || scannerProvenCells(s).length > 0) return null;
      const ring = openRings(s)[0];
      if (!ring || ring.cands.length !== 2) return null;
      const a = aimed(s);
      const lazy = scannerSafePing(s)!;
      if (tells(a, ring.cands) !== 2 || tells(lazy, ring.cands) !== 1) return null;
      const proven = scannerProvenCells(play(s, { type: "ping", cell: a })).filter((c) => ring.cands.includes(c));
      if (proven.length !== 1 || scannerProvenCells(play(s, { type: "ping", cell: lazy })).length > 0) return null;
      return { ring: ring.cell, ping: a, lock: proven[0]! };
    }),
  );
  await open(page, seed);
  let s = await lead(page, seed, found.line);
  await clip(page, "scanner", "aim", async () => {
    await light(page, found.at.ring);
    await page.waitForTimeout(1000);
    s = await ping(page, s, found.at.ping);
    await page.waitForTimeout(800);
    s = await hold(page, s, found.at.lock);
    await landed(page, s);
  }, { leadMs: 600, tailMs: 1300, region: await region(page) });
});

test("scanner: the numbers are live", async ({ page }) => {
  // A lock that makes several pings sound again: their numbers grow, the shading grows with them,
  // and the new shading proves the next contact with no ping spent.
  const { seed, found } = findSeed("scan-live", (seed) =>
    walk(seed, (s, line) => {
      const proven = scannerProvenCells(s);
      if (proven.length === 0 || line.length > 4 || !inner(proven[0]!)) return null;
      const s1 = play(s, { type: "lock", cell: proven[0]! });
      const report = s1.lastMove!;
      if (report.cleared || report.resound.length < 2) return null;
      const shaded = (g: ScannerState): number => scannerClearCells(g).filter(Boolean).length;
      return shaded(s1) - shaded(s) >= 6 && scannerProvenCells(s1).length > 0 ? { lock: proven[0]! } : null;
    }),
  );
  await open(page, seed);
  let s = await lead(page, seed, found.line);
  await clip(page, "scanner", "live", async () => {
    s = await hold(page, s, found.at.lock);
    await landed(page, s);
  }, { leadMs: 1100, tailMs: 1600, region: await region(page) });
});

test("scanner: one ping, two locks", async ({ page }) => {
  // Two open rings. One ping tells the cells of both apart: it proves a contact, and the lock on
  // that one makes the numbers sound again and proves a second on the other ring.
  const { seed, found } = findSeed("scan-two", (seed) =>
    walk(seed, (s, line) => {
      if (line.length > 3 || scannerProvenCells(s).length > 0) return null;
      const rings = openRings(s);
      const a = aimed(s);
      if (rings.length < 2 || !inner(a)) return null;
      const s1 = play(s, { type: "ping", cell: a });
      const first = scannerProvenCells(s1)[0];
      if (first === undefined) return null;
      const s2 = play(s1, { type: "lock", cell: first });
      const second = s2.lastMove!.cleared ? undefined : scannerProvenCells(s2)[0];
      if (second === undefined) return null;
      const ra = rings.find((r) => r.cands.includes(first));
      const rb = rings.find((r) => r.cands.includes(second) && !r.cands.includes(first));
      return ra && rb && ra.cell !== rb.cell ? { ping: a, locks: [first, second] as const } : null;
    }),
  );
  await open(page, seed);
  let s = await lead(page, seed, found.line);
  await clip(page, "scanner", "two-rings", async () => {
    s = await ping(page, s, found.at.ping);
    await page.waitForTimeout(700);
    s = await hold(page, s, found.at.locks[0]);
    await landed(page, s);
    await page.waitForTimeout(500);
    s = await hold(page, s, found.at.locks[1]);
    await landed(page, s);
  }, { leadMs: 900, tailMs: 1300, region: await region(page) });
});

test("scanner: two rings cross on the last contact", async ({ page }) => {
  // One contact left, pings in hand, and no ring down to one cell. Two rings share exactly one fog
  // cell, and the last contact is on every ring, so it is there: a lock with no further ping.
  const { seed, found } = findSeed("scan-cross", (seed) =>
    walk(seed, (s) => {
      if (scannerContactsLeft(s) !== 1 || scannerProvenCells(s).length > 0 || s.spent >= s.par || s.misses.length > 0 || s.spooked.length > 0) return null;
      const rings = openRings(s);
      // The shortest pair first.
      for (const a of rings) {
        for (const b of rings) {
          if (a.cell === b.cell) continue;
          const both = a.cands.filter((c) => b.cands.includes(c));
          if (both.length === 1 && inner(both[0]!) && a.cands.length <= b.cands.length && b.cands.length >= 3) return { a: a.cell, b: b.cell, lock: both[0]! };
        }
      }
      return null;
    }),
  );
  await open(page, seed);
  let s = await lead(page, seed, found.line);
  await clip(page, "scanner", "cross", async () => {
    await light(page, found.at.a);
    await page.waitForTimeout(1100);
    await light(page, found.at.b);
    await page.waitForTimeout(1100);
    s = await hold(page, s, found.at.lock);
    // No wait for the next sector: the picture ends on this one's clean sweep.
  }, { leadMs: 600, tailMs: 750, region: await region(page) });
});

test("scanner: a streak", async ({ page }) => {
  // Three sectors in a row cleared clean with pings to spare, every move a lock a ring proves or an
  // aimed ping. The picture is the third sector's last lock.
  const { seed, found } = findSeed("scan-streak", (seed) => {
    let s = deal(seed);
    const line: Move[] = [];
    while (s.sectorsCleared < 3) {
      const m = next(s);
      line.push(m);
      s = play(s, m);
      const c = s.lastMove!.cleared;
      if ((c && (!c.clean || c.saved < 1)) || line.length > 22) return null;
    }
    const last = line[line.length - 1]!;
    return s.lastMove!.cleared!.saved >= 2 && inner(last.cell) ? line : null;
  });
  await open(page, seed);
  let s = await lead(page, seed, found.slice(0, -1));
  await clip(page, "scanner", "streak", async () => {
    s = await hold(page, s, found[found.length - 1]!.cell);
  }, { leadMs: 900, tailMs: 750, region: await region(page) });
  expect(replay(seed, found).combo).toBe(3);
});
