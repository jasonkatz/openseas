import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createEnginesGame,
  enginesLandingRow,
  enginesPairCells,
  enginesSpawnPosition,
  reduceEngines,
  type EnginesMoveReport,
  type EnginesState,
  type Rotation,
} from "@openseas/engine";
import { boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.engines.config;
const W = cfg.width;
const H = cfg.height;
const SPAWN = enginesSpawnPosition(cfg);
/**
 * The engine's column for the pair once it has turned to `rot` at the entry. The pivot is the left
 * or bottom half, so a pair turned counter-clockwise by key walks a column left on its second turn;
 * one turned clockwise by tap stays where it entered.
 */
const turnedCol = (rot: Rotation, turn: "tap" | "keys"): number => (turn === "keys" && rot >= 2 ? SPAWN.col - 1 : SPAWN.col);

interface Place {
  col: number;
  row: number;
  rot: Rotation;
}

const deal = (seed: string): EnginesState => createEnginesGame(seed, cfg);
const put = (s: EnginesState, p: Place): EnginesState => reduceEngines(s, { type: "place", ...p });

// ---- planning, in Node, with the engine

/** How far down the pair may sink while the hand turns and steers it, before the swipe that hurries it. */
const SLACK = 5;

/**
 * Straight drops: turn and steer in the top rows, then fall. Only columns whose top rows are empty
 * all the way from the entry, so the page can play the same landing however slowly the hand moves.
 */
function drops(s: EnginesState): Place[] {
  const held = new Set<number>();
  for (const p of s.injectors) for (const c of p.cells) held.add(c.row * W + c.col);
  const open = (col: number): boolean => {
    for (let r = H - SLACK; r < H; r++) if (s.cells[r * W + col] || held.has(r * W + col)) return false;
    return true;
  };
  const out: Place[] = [];
  for (const rot of [0, 1, 2, 3] as const) {
    const span = rot % 2 === 0 ? 2 : 1;
    for (let col = 0; col + span <= W; col++) {
      let ok = true;
      for (let c = Math.min(col, SPAWN.col); c <= Math.max(col + span - 1, SPAWN.col + 1); c++) if (!open(c)) ok = false;
      if (ok) out.push({ col, rot, row: enginesLandingRow(s, col, H - 1, rot) });
    }
  }
  return out;
}

/** The board with the pair resting at `p`, or null when that landing clears something (the engine then says what). */
function rested(s: EnginesState, p: Place): EnginesState | null {
  const at = enginesPairCells(cfg, p.col, p.row, p.rot)!;
  const cells = s.cells.slice();
  cells[at.a] = { id: -1, kind: s.current.a, pair: -1 };
  cells[at.b] = { id: -2, kind: s.current.b, pair: -1 };
  const kind = (c: number, r: number): number => (c < 0 || c >= W || r < 0 || r >= H ? -1 : (cells[r * W + c]?.kind ?? -1));
  for (const i of [at.a, at.b]) {
    const c = i % W;
    const r = Math.floor(i / W);
    const k = kind(c, r);
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      let n = 1;
      for (let d = 1; kind(c + dc * d, r + dr * d) === k; d++) n++;
      for (let d = 1; kind(c - dc * d, r - dr * d) === k; d++) n++;
      if (n >= 4) return null;
    }
  }
  for (const inj of s.injectors) {
    const wants = inj.cells.filter((c) => c.want !== null);
    if (wants.every((c) => cells[c.row * W + c.col]?.kind === c.want)) return null;
  }
  return { ...s, cells };
}

/**
 * How good a board is to build on. Pellets on their own targets count, wrong ones cost, and so does
 * height. `feed` is the weight of the chain idea: an open target with its own kind waiting straight
 * above it, held up by something that will fire.
 */
function worth(s: EnginesState, feed: number): number {
  let v = 0;
  const owner = new Map<number, number>();
  for (const p of s.injectors) for (const c of p.cells) owner.set(c.row * W + c.col, p.id);
  for (const p of s.injectors) {
    const wants = p.cells.filter((c) => c.want !== null);
    const have = wants.filter((c) => s.cells[c.row * W + c.col]?.kind === c.want).length;
    const wrong = wants.filter((c) => s.cells[c.row * W + c.col] && s.cells[c.row * W + c.col]!.kind !== c.want).length;
    v += 2 * have - 4 * wrong;
    if (wrong === 0 && have === wants.length - 1) v += 2;
    if (!feed || wrong) continue;
    for (const c of wants) {
      if (s.cells[c.row * W + c.col]) continue;
      for (let r = c.row + 1; r < H; r++) {
        const i = r * W + c.col;
        const seg = s.cells[i];
        if (!seg) {
          // Another injector's empty cell has a shelf that would catch the pellet.
          if (owner.has(i) && owner.get(i) !== p.id) break;
          continue;
        }
        v += seg.kind === c.want ? feed * (have === wants.length - 1 ? 2 : 1) : -feed;
        break;
      }
    }
  }
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i]) v -= 0.05 * Math.floor(i / W);
  return v;
}

interface Line {
  /** The landings that set the board up. None of them clears anything. */
  log: Place[];
  /** The landing the picture is about. */
  last: Place;
  report: EnginesMoveReport;
  before: EnginesState;
}

/**
 * Play straight drops that clear nothing, keeping the `beam` best boards, until one landing does
 * what `want` asks. This is how a player sets a chain up: load the injectors, fire none of them.
 */
function plan(seed: string, want: (r: EnginesMoveReport, before: EnginesState) => boolean, opts: { feed?: number; beam?: number; moves?: number; atLeast?: number } = {}): Line | null {
  const feed = opts.feed ?? 0;
  let nodes: { s: EnginesState; log: Place[] }[] = [{ s: deal(seed), log: [] }];
  for (let n = 0; n < (opts.moves ?? 10); n++) {
    const next: { s: EnginesState; p: Place; log: Place[]; v: number }[] = [];
    for (const node of nodes) {
      for (const p of drops(node.s)) {
        const quiet = rested(node.s, p);
        if (quiet) {
          next.push({ s: node.s, p, log: node.log, v: worth(quiet, feed) });
          continue;
        }
        // The last landing is played by hand in the picture: the pair needs room under the entry to be steered in.
        if (n < (opts.atLeast ?? 1) || enginesLandingRow(node.s, SPAWN.col, H - 1, 0) > H - 10) continue;
        const r = put(node.s, p).lastMove!;
        if (!r.wipe && want(r, node.s)) return { log: node.log, last: p, report: r, before: node.s };
      }
    }
    next.sort((a, b) => b.v - a.v);
    nodes = next.slice(0, opts.beam ?? 1).map((x) => ({ s: put(x.s, x.p), log: [...x.log, x.p] }));
    if (!nodes.length) return null;
  }
  return null;
}

const fired = (r: EnginesMoveReport, step: number): number => r.rounds[step]?.groups.filter((g) => g.cause === "injector").length ?? 0;

// ---- playing, on the page

interface Geom {
  /** Page position of the board's top left cell corner, and the cell size. */
  ox: number;
  oy: number;
  cell: number;
  strip: number;
  box: Box;
}

/** Where the renderer lays the core out inside its canvas (the same sums as its `layout`). */
async function geom(page: Page): Promise<Geom> {
  const box = await canvasBox(page, "engines");
  const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
  const rows = H + 1.2;
  let cell = Math.floor(Math.min(box.width / W, box.height / rows));
  cell = Math.max(12, Math.floor(Math.min((box.width - padFor(cell) * 2 - 2) / W, (box.height - padFor(cell) * 2 - 2) / rows)));
  const strip = Math.round(cell * 1.2);
  return { ox: box.x + Math.floor((box.width - cell * W) / 2), oy: box.y + Math.floor((box.height - cell * H - strip) / 2) + strip, cell, strip, box };
}

/** The core with its frame and the next-pair strip above it. */
async function region(page: Page): Promise<Box> {
  const g = await geom(page);
  return padded({ x: g.ox, y: g.oy - g.strip, width: g.cell * W, height: g.cell * H + g.strip }, 14, g.box);
}

const moves = (page: Page) => page.getByTestId("hud-moves");

/** The page's board must be the one Node planned on. */
async function same(page: Page, s: EnginesState): Promise<void> {
  await settled(page, "engines");
  expect(await boardString(page, "engines")).toBe(s.cells.map((c) => c?.kind ?? -1).join(","));
}

/**
 * Land the falling pair with the pointer, as a thumb would: tap to turn it, drag sideways to steer
 * it, then hold a swipe down until it lands. A tap anywhere on the board turns the pair. `count` is the move count once it has.
 */
async function drop(page: Page, p: Place, count: number, turn: "tap" | "keys" = "keys"): Promise<void> {
  const g = await geom(page);
  const x = g.ox + (SPAWN.col + 1) * g.cell;
  const y = g.oy + 3 * g.cell;
  // Few, long mouse steps: on a busy machine every step costs time, and the pair is sinking.
  await page.mouse.move(x, y, { steps: 3 });
  // Turning by key is instant, for a clip that is about what happens after the landing.
  // Up steps the rotation up by one (counter-clockwise); a tap steps it down (clockwise).
  if (turn === "keys") for (let i = 0; i < p.rot; i++) await page.keyboard.press("ArrowUp");
  else for (let i = 0; i < (4 - p.rot) % 4; i++) {
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(160);
  }
  const to = x + (p.col - turnedCol(p.rot, turn)) * g.cell;
  if (p.col !== turnedCol(p.rot, turn)) {
    await page.mouse.down();
    await page.mouse.move(to, y, { steps: 4 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  // A short, quick swipe, then lift the moment the pair lands: a swipe still moving or still held hurries the next pair too.
  await page.mouse.down();
  await page.mouse.move(to, y + 2 * g.cell, { steps: 3 });
  await page.waitForFunction((n) => document.querySelector('[data-testid="hud-moves"]')?.textContent?.trim() === n, String(count), { polling: "raf", timeout: 15_000 });
  await page.mouse.up();
}

/** The same landing by keyboard, for the setup a picture does not show: quick, so a busy machine cannot let the pair sink. */
async function dropByKeys(page: Page, p: Place, count: number): Promise<void> {
  for (let i = 0; i < p.rot; i++) await page.keyboard.press("ArrowUp");
  for (let i = 0; i < Math.abs(p.col - turnedCol(p.rot, "keys")); i++) await page.keyboard.press(p.col < turnedCol(p.rot, "keys") ? "ArrowLeft" : "ArrowRight");
  // Space again every so often: a key that went down before the board had the pair would hurry nothing.
  await expect(async () => {
    await page.keyboard.down(" ");
    await expect(moves(page)).toHaveText(String(count), { timeout: 400 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.up(" ");
  await frames(page);
}

/** Two frames: the board has taken the new state and holds the next pair. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/**
 * A still taken now and written later. The pair starts to sink the moment the one before it lands,
 * so the picture of the board before a play is grabbed at once and encoded (as `still` does) after the clip.
 */
async function snap(page: Page, name: string, box: Box): Promise<() => void> {
  const png = await page.screenshot({ clip: box });
  return () => {
    const tmp = mkdtempSync(join(tmpdir(), "openseas-snap-"));
    try {
      writeFileSync(join(tmp, "snap.png"), png);
      const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media", "engines", `${name}.webp`);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(tmp, "snap.png"), "-vf", "scale='min(840,iw)':-2:flags=lanczos", "-c:v", "libwebp", "-quality", "84", out], { stdio: ["ignore", "ignore", "inherit"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

/**
 * The picture of a line: its setup played by key, the board as it stands (`<name>-before`), then
 * the last landing by hand as the clip `<name>`. Nothing slow sits between the setup's last landing
 * and the hand, so the pair is still near the top when it is steered.
 */
async function film(page: Page, seed: string, line: Line, name: string, opts: { before?: boolean; turn?: "tap" | "keys"; tailMs?: number } = {}): Promise<void> {
  await openLab(page, "engines", { seed });
  const box = await region(page);
  let s = deal(seed);
  for (const [i, p] of line.log.entries()) {
    if (i === line.log.length - 1) await hidePointer(page);
    if (i === line.log.length - 1) await same(page, s);
    await dropByKeys(page, p, i + 1);
    s = put(s, p);
  }
  await page.waitForTimeout(160);
  const write = opts.before ? await snap(page, `${name}-before`, box) : null;
  await clip(page, "engines", name, async () => {
    await drop(page, line.last, line.log.length + 1, opts.turn);
    await same(page, put(s, line.last));
  }, { leadMs: 120, tailMs: opts.tailMs ?? 1300, region: box });
  write?.();
}

test("engines: the board", async ({ page }) => {
  // A core a few pairs in: several injectors part loaded, nothing fired yet.
  const { seed, found } = findSeed("eng-hero", (s) => {
    let g = deal(s);
    const log: Place[] = [];
    for (let n = 0; n < 7; n++) {
      let best: { p: Place; v: number } | null = null;
      for (const p of drops(g)) {
        const quiet = rested(g, p);
        if (!quiet) continue;
        const v = worth(quiet, 0);
        if (!best || v > best.v) best = { p, v };
      }
      if (!best) return null;
      log.push(best.p);
      g = put(g, best.p);
    }
    const loaded = g.injectors.filter((inj) => inj.cells.some((c) => c.want !== null && g.cells[c.row * W + c.col]?.kind === c.want)).length;
    const shapes = new Set(g.injectors.map((inj) => `${new Set(inj.cells.map((c) => c.col)).size}x${new Set(inj.cells.map((c) => c.row)).size}`)).size;
    return loaded >= 4 && shapes >= 3 && g.current.a !== g.current.b ? { log } : null;
  });
  await openLab(page, "engines", { seed });
  let s = deal(seed);
  for (const [i, p] of found.log.entries()) {
    await dropByKeys(page, p, i + 1);
    s = put(s, p);
  }
  await same(page, s);
  // Let the next pair sink a few rows so the picture shows it over its landing ring.
  await hidePointer(page);
  await page.waitForTimeout(2600);
  await still(page, "engines", "board", { region: await region(page) });
});

test("engines: a first injector", async ({ page }) => {
  // After one quiet landing, a pair fills both targets of an injector: one turn, a steer and a swipe.
  const { seed, found } = findSeed("eng-first", (s) =>
    plan(s, (r) => {
      const group = r.rounds[0]?.groups[0];
      const p = r.move.type === "place" ? r.move : null;
      return !!p && p.rot === 3 && Math.abs(p.col - SPAWN.col) >= 2 && r.rounds.length === 1 && r.rounds[0]!.groups.length === 1 && group?.cause === "injector" && r.landed!.cells.every((c) => group.cells.includes(c));
    }, { moves: 2 }),
  );
  await film(page, seed, found, "first-injector", { turn: "tap", tailMs: 1200 });
});

test("engines: the spare half chains", async ({ page }) => {
  // One landing fires an injector, the half it leaves behind falls into a second and fires that too.
  const { seed, found } = findSeed("eng-chain", (s) =>
    plan(s, (r, before) => {
      if (r.rounds.length !== 2 || fired(r, 0) !== 1 || fired(r, 1) !== 1 || r.rounds[0]!.groups.length !== 1 || r.rounds[1]!.groups.length !== 1) return false;
      // The pellet that finishes the second injector is the landed pair's other half, after a fall worth watching.
      const [a, b] = r.landed!.ids;
      const first = r.rounds[0]!.groups[0]!;
      const second = r.rounds[1]!.groups[0]!;
      const spare = first.ids.includes(a) ? b : a;
      if (first.ids.includes(spare) || !second.ids.includes(spare) || second.cells.length < 2) return false;
      const from = r.landed!.cells[r.landed!.ids.indexOf(spare)]!;
      const to = second.cells[second.ids.indexOf(spare)]!;
      return Math.floor(from / W) - Math.floor(to / W) >= 3 && before.moveCount >= 3;
    }, { moves: 9 }),
  );
  await film(page, seed, found, "chain", { before: true });
});

test("engines: three steps from one landing", async ({ page }) => {
  // The expert line: each injector that fires drops a pellet into the next. Three steps, all injectors.
  const { seed, found } = findSeed("eng-three", (s) => plan(s, (r) => r.rounds.length === 3 && fired(r, 0) >= 1 && fired(r, 1) >= 1 && fired(r, 2) >= 1, { feed: 3, beam: 3, moves: 10, atLeast: 3 }), 600);
  await film(page, seed, found, "three", { before: true, tailMs: 1500 });
});
