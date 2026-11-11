import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  advanceSwordfight,
  createSwordfightGame,
  reduceSwordfight,
  swordfightApplyDrop,
  swordfightBoardString,
  swordfightColHeight,
  swordfightLegalDrops,
  swordfightSpawnCol,
  type Slab,
  type SwordBoard,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightDropResult,
  type SwordfightEvent,
  type SwordfightState,
} from "@openseas/engine";
import { boardString, canvasAttr, canvasBox, clip, findSeed, glide, hidePointer, openLab, settled, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.swordfight.config;
const W = cfg.width;
const H = cfg.height;

/**
 * A raider that never drops. A fight against the content raider depends on when each drop is made,
 * because its scrap lands on the clock. With the raider asleep the player's board is a pure
 * function of the drops, so Node can plan a line and the page plays the same one.
 */
const ASLEEP = [{ thinkTicks: 10_000, skill: cfg.foes[0]!.skill, blade: cfg.foes[0]!.blade }];
const quiet: SwordfightConfig = { ...cfg, foes: ASLEEP };

// ---- planning, in Node, with the engine

interface Drop {
  col: number;
  rot: SwordRotation;
}
interface Try extends Drop {
  r: SwordfightDropResult;
}
type Broke = Extract<SwordfightEvent, { type: "broke" }>;

const SCRATCH = { a: 1, b: 2, c: 3, d: 4 };

/** Every drop the pair in hand can make, played out. */
function tries(c: SwordfightConfig, b: SwordBoard): Try[] {
  return swordfightLegalDrops(c, b).map((d) => ({ ...d, r: swordfightApplyDrop(c, b, 0, d.col, d.rot, 0, SCRATCH, 1_000_000, 1_000_000) }));
}

const broke = (t: Try): Broke[] => t.r.events.filter((e): e is Broke => e.type === "broke");

/** How good a board is to build on: slabs, colors kept together, low columns. A drop that breaks is not building. */
function worth(c: SwordfightConfig, t: Try): number {
  let v = t.r.points > 0 ? -400 : 0;
  for (let col = 0; col < c.width; col++) {
    const h = swordfightColHeight(c, t.r.cells, col);
    v -= h * h * (col === swordfightSpawnCol(c) ? 4 : 2);
  }
  for (const s of t.r.slabs) v += (s.w * s.h) ** 2 * 3;
  t.r.cells.forEach((cell, i) => {
    if (!cell || cell.kind !== "block") return;
    const right = i % c.width < c.width - 1 ? t.r.cells[i + 1] : null;
    const up = t.r.cells[i + c.width];
    if (right && right.kind === "block" && right.color === cell.color) v += 10;
    if (up && up.kind === "block" && up.color === cell.color) v += 10;
  });
  return v;
}

/** The drop a patient builder makes: the best board to build on, and nothing shattered. Null when every drop breaks. */
function builderDrop(c: SwordfightConfig, b: SwordBoard): Try | null {
  let best: Try | null = null;
  let bv = -Infinity;
  for (const t of tries(c, b)) {
    const v = worth(c, t);
    if (v > bv) {
      bv = v;
      best = t;
    }
  }
  return best && best.r.points === 0 ? best : null;
}

interface Line {
  /** The builder's drops up to the one the picture is about. */
  log: Drop[];
  hit: Try;
  before: SwordfightState;
}

/**
 * Build without breaking until the pair in hand has a drop that `want` accepts. The builder never
 * fires a breaker, so breakers wait where they land and slabs grow: the board a strong player keeps.
 */
function build(c: SwordfightConfig, seed: string, maxDrops: number, want: (t: Try, s: SwordfightState) => boolean, minDrops = 0): Line | null {
  let s = createSwordfightGame(seed, c);
  const log: Drop[] = [];
  for (let n = 0; n <= maxDrops; n++) {
    if (n >= minDrops) {
      const hit = tries(c, s.boards[0]!).find((t) => want(t, s));
      if (hit) return { log, hit, before: s };
    }
    const next = builderDrop(c, s.boards[0]!);
    if (!next) return null;
    log.push({ col: next.col, rot: next.rot });
    s = reduceSwordfight(s, { type: "place", col: next.col, rot: next.rot, tick: s.tick + c.dropTicks });
  }
  return null;
}

/** The most blocks of one slab among these cells. */
function slabBlocks(b: SwordBoard, cells: readonly number[]): number {
  const per = new Map<number, number>();
  for (const i of cells) {
    const slab = b.cells[i]?.slab;
    if (slab) per.set(slab, (per.get(slab) ?? 0) + 1);
  }
  return Math.max(0, ...per.values());
}

const breakers = (b: SwordBoard): number => b.cells.filter((c) => c?.kind === "breaker").length;

/** When the content raider's first attack reaches a player who has sent nothing, and how much scrap it is. */
function firstAttack(seed: string): { tick: number; scrap: number } | null {
  const s = advanceSwordfight(createSwordfightGame(seed, cfg), 300);
  const e = s.lastMove?.events.find((x) => x.type === "attack" && x.board !== 0 && x.scrap > 0);
  return e && e.type === "attack" ? { tick: e.tick, scrap: e.scrap } : null;
}

// ---- the page

/**
 * Every round here is opened with its clock stopped and stepped a tick at a time (the bench's own
 * step button). A drop is then made at a tick this file chose, so Node plays the same fight ahead of
 * the page, raider and all, and each drop is checked against it. It also keeps a slow machine honest:
 * with the clock running, a frame that takes longer than a tick can lose a drop's landing.
 */
interface Fight {
  page: Page;
  c: SwordfightConfig;
  /** The fight as Node has played it so far. */
  st: SwordfightState;
  g: Geom;
}

interface Geom {
  cell: number;
  /** The well's top-left corner, in page pixels. */
  x: number;
  y: number;
  /** The player's board with the next pair above it and the raider's small board beside it. */
  region: Box;
}

/** Where the well sits in the canvas: the renderer's own layout sums (`SwordfightRenderer.layout`), for a fight with one other board. */
async function geom(page: Page): Promise<Geom> {
  const box = await canvasBox(page, "swordfight");
  const stripRows = 1.6;
  const miniScale = 0.3;
  const cols = W + (W * miniScale * 0.8 + 0.7) * 2;
  const rows = H + stripRows;
  const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
  let cell = Math.floor(Math.min(box.width / cols, box.height / rows));
  cell = Math.max(12, Math.floor(Math.min((box.width - padFor(cell) * 2 - 2) / cols, (box.height - padFor(cell) * 2 - 2) / rows)));
  const pad = padFor(cell);
  const strip = Math.round(cell * stripRows);
  const ox = Math.floor((box.width - cell * W) / 2);
  const oy = Math.floor((box.height - cell * H - strip) / 2) + strip;
  const mini = Math.max(5, Math.floor(cell * miniScale)) * W;
  const left = Math.max(0, ox - pad - 8);
  const right = Math.min(box.width, ox + cell * W + pad + 6 + mini + 12);
  return { cell, x: box.x + ox, y: box.y + oy, region: { x: box.x + left, y: box.y, width: right - left, height: box.height } };
}

async function open(page: Page, seed: string, c: SwordfightConfig): Promise<Fight> {
  await openLab(page, "swordfight", { seed, paused: true, ...(c === quiet ? { config: { foes: ASLEEP } } : {}) });
  return { page, c, st: createSwordfightGame(seed, c), g: await geom(page) };
}

const hudNumber = async (page: Page, id: string): Promise<number> => Number.parseInt((await page.getByTestId(id).textContent()) ?? "0", 10);

/** The fight's tick, from the bench's clock. */
async function tickNow(page: Page): Promise<number> {
  const m = /tick (\d+)/.exec((await page.getByTestId("clock-readout").textContent()) ?? "");
  return m ? Number(m[1]) : 0;
}

/** Step the stopped clock up to a tick. The button is clicked in the page, so the pointer stays where the hand left it. */
async function stepTo(page: Page, tick: number): Promise<void> {
  for (let n = 0; n < 2000 && (await tickNow(page)) < tick; n++) {
    await page.getByTestId("clock-step").evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(20);
  }
}

/** The falling pair as the canvas publishes it: its pivot's column, its rotation and its row. Null between pairs. */
async function falling(page: Page): Promise<{ pc: number; rot: SwordRotation; row: number } | null> {
  const [pc, rot, row] = (await canvasAttr(page, "swordfight", "data-falling")).split(",").map(Number);
  return pc === undefined || rot === undefined || row === undefined || Number.isNaN(rot) ? null : { pc, rot: rot as SwordRotation, row };
}

/** The renderer steers the pivot half; the engine's anchor is the left column of a pair lying down. */
const pivotOf = (d: Drop): number => (d.rot === 2 ? d.col + 1 : d.col);
/** Clockwise turns go 1, 0, 3, 2. */
const TURNS: readonly SwordRotation[] = [1, 0, 3, 2];

/** Steer and turn the pair with the keyboard until it hangs over the drop. */
async function steer(page: Page, d: Drop): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const f = await falling(page);
    if (!f) {
      await page.waitForTimeout(50);
      continue;
    }
    if (f.rot === d.rot && f.pc === pivotOf(d)) return;
    if (f.rot !== d.rot) await page.keyboard.press((TURNS.indexOf(d.rot) - TURNS.indexOf(f.rot) + 4) % 4 === 3 ? "ArrowDown" : "ArrowUp");
    else await page.keyboard.press(f.pc < pivotOf(d) ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(40);
  }
  throw new Error(`could not steer to ${d.col},${d.rot}`);
}

/** Wait, in the page, for the engine to take the pair: the drop count goes up. */
async function taken(page: Page, before: number): Promise<void> {
  await page.waitForFunction((n) => Number.parseInt(document.querySelector('[data-testid="hud-moves"]')?.textContent ?? "0", 10) > n, before, { polling: 50, timeout: 30_000 });
}

/** Tap to turn, drag sideways to steer: what a thumb does before it lets the pair go. */
async function steerByHand(f: Fight, d: Drop): Promise<void> {
  const { page, g } = f;
  const y = g.y + g.cell * (H - 7);
  let now = (await falling(page))!;
  const turns = (TURNS.indexOf(d.rot) - TURNS.indexOf(now.rot) + 4) % 4;
  for (let n = 0; n < turns; n++) {
    await tapAt(page, g.x + g.cell * (W / 2), y);
    await page.waitForTimeout(220);
  }
  now = (await falling(page))!;
  const dx = pivotOf(d) - now.pc;
  if (dx !== 0) {
    const x = g.x + g.cell * (W / 2 - dx / 2);
    await glide(page, x, y, 160);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await glide(page, x + dx * g.cell, y, 380);
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  // A turn against a wall kicks the pair sideways: the keys put right whatever the hand left.
  await steer(page, d);
}

/** Swipe down on the board and hold until the pair lands: the touch way to hurry. */
async function hurryByHand(f: Fight): Promise<void> {
  const { page, g } = f;
  const before = await hudNumber(page, "hud-moves");
  const x = g.x + g.cell * (W / 2);
  const y = g.y + g.cell * (H - 7);
  await glide(page, x, y, 160);
  await page.mouse.down();
  await glide(page, x, y + g.cell * 1.6, 200);
  await taken(page, before);
  await page.mouse.up();
}

/**
 * One drop, at a tick: by keyboard, or with the pointer as a thumb makes it. Node makes the same
 * drop, and the page's board must then be Node's.
 */
async function drop(f: Fight, d: Drop, opts: { tick?: number; hand?: boolean } = {}): Promise<void> {
  const { page } = f;
  const tick = opts.tick ?? Math.max(f.st.tick, f.st.boards[0]!.spawnedAt) + f.c.dropTicks;
  await stepTo(page, tick);
  await expect.poll(() => falling(page), { timeout: 15_000 }).not.toBeNull();
  if (opts.hand) {
    await steerByHand(f, d);
    await hurryByHand(f);
  } else {
    await steer(page, d);
    const before = await hudNumber(page, "hud-moves");
    await page.keyboard.down(" ");
    await taken(page, before);
    await page.keyboard.up(" ");
  }
  f.st = reduceSwordfight(f.st, { type: "place", col: d.col, rot: d.rot, tick });
  await expect.poll(() => boardString(page, "swordfight"), { timeout: 10_000 }).toBe(swordfightBoardString(f.c, f.st.boards[0]!.cells));
}

/** Let the board finish drawing what the last drop did. */
async function rest(page: Page, ms = 300): Promise<void> {
  await settled(page, "swordfight", 6000);
  await page.waitForTimeout(ms);
}

/** Play the builder's drops by keyboard, two ticks apart. */
async function playLog(f: Fight, log: readonly Drop[]): Promise<void> {
  for (const d of log) await drop(f, d);
  await rest(f.page, 500);
  await f.page.mouse.move(f.g.x + f.g.cell * (W / 2), f.g.y + f.g.cell * (H - 7));
}

// ---- the pictures

test("swordfight: a first break", async ({ page }) => {
  // A few loose blocks down, then a pair with one breaker that can come to rest against three or more of its color.
  const { seed, found } = findSeed("sword-first", (s) =>
    build(
      quiet,
      s,
      4,
      (t, st) => {
        const b = broke(t);
        const pair = st.boards[0]!.current;
        return breakers(st.boards[0]!) === 0 && pair.a.breaker !== pair.b.breaker && t.rot !== 1 && t.col !== swordfightSpawnCol(quiet) && b.length === 1 && b[0]!.groups.length === 1 && b[0]!.groups[0]!.cells.length >= 4;
      },
      3,
    ),
  );
  const f = await open(page, seed, quiet);
  await playLog(f, found.log);
  await clip(page, "swordfight", "first-break", async () => {
    await drop(f, found.hit, { hand: true });
    await rest(page);
  }, { tailMs: 1300, region: f.g.region });
});

test("swordfight: a slab fuses and grows", async ({ page }) => {
  // One drop finishes a two by two, the next lays a full strip against it.
  const { seed, found } = findSeed("sword-fuse", (s) => {
    const line = build(quiet, s, 8, (t, st) => st.boards[0]!.slabs.length === 0 && t.r.points === 0 && t.r.slabs.length === 1, 2);
    if (!line) return null;
    const made = reduceSwordfight(line.before, { type: "place", col: line.hit.col, rot: line.hit.rot, tick: line.before.tick + quiet.dropTicks });
    const grow = tries(quiet, made.boards[0]!).find((t) => t.r.points === 0 && t.r.slabs.length === 1 && t.r.slabs[0]!.w * t.r.slabs[0]!.h === 6);
    return grow ? { ...line, grow } : null;
  });
  const f = await open(page, seed, quiet);
  await playLog(f, found.log);
  await clip(page, "swordfight", "slab", async () => {
    await drop(f, found.hit, { hand: true });
    await rest(page, 500);
    await drop(f, found.grow, { hand: true });
    await rest(page);
  }, { tailMs: 1300, region: f.g.region });
});

test("swordfight: a big slab shatters", async ({ page }) => {
  // The builder grows a slab and parks its breakers. Then one breaker takes a slab of eight or more.
  const { seed, found } = findSeed("sword-slab", (s) =>
    build(quiet, s, 18, (t, st) => {
      const b = broke(t);
      return b.length === 1 && b[0]!.groups.length === 1 && slabBlocks(st.boards[0]!, b[0]!.groups[0]!.cells) >= 8;
    }),
  );
  const f = await open(page, seed, quiet);
  await playLog(f, found.log);
  await clip(page, "swordfight", "big-break", async () => {
    await drop(f, found.hit, { hand: true });
    await rest(page);
    // The scrap it made waits over the raider's board. Time lands it.
    await stepTo(page, f.st.tick + quiet.landAfterTicks + 1);
  }, { tailMs: 2200, region: f.g.region });
});

test("swordfight: a chain", async ({ page }) => {
  // One breaker clears a color, what was above falls, and a second breaker that was waiting takes a slab on chain 2.
  const { seed, found } = findSeed("sword-chain", (s) =>
    build(quiet, s, 22, (t, st) => {
      const b = broke(t);
      return b.length === 2 && b[0]!.groups.length === 1 && b[1]!.groups.length === 1 && b[0]!.groups[0]!.cells.length >= 3 && slabBlocks(st.boards[0]!, b[1]!.groups[0]!.cells) >= 6;
    }),
  );
  const f = await open(page, seed, quiet);
  await playLog(f, found.log);
  await clip(page, "swordfight", "chain", async () => {
    await drop(f, found.hit, { hand: true });
    await rest(page);
  }, { leadMs: 1200, tailMs: 2400, region: f.g.region });
});

test("swordfight: scrap lands and ripens, and the board", async ({ page }) => {
  // The content raider. The builder has a slab down when the raider's first attack comes, and it is
  // a big one. It lands with the next drop, shows its colors after one more and ripens after two.
  const after = cfg.ripenMoves + 1;
  const { seed, found } = findSeed("sword-scrap", (s) => {
    const hit = firstAttack(s);
    if (!hit || hit.scrap < 8 || hit.tick < 40) return null;
    let st = createSwordfightGame(s, cfg);
    const log: Drop[] = [];
    for (let n = 0; n < 9 + after; n++) {
      const tick = n < 9 ? (n + 1) * cfg.dropTicks : hit.tick + (n - 8) * cfg.dropTicks;
      if (n < 9 && tick >= hit.tick) return null;
      const d = builderDrop(cfg, st.boards[0]!);
      if (!d) return null;
      log.push({ col: d.col, rot: d.rot });
      st = reduceSwordfight(st, { type: "place", col: d.col, rot: d.rot, tick });
      const b = st.boards[0]!;
      if (b.out) return null;
      // Built before the attack: a slab and a breaker waiting. Landed with the first drop after it: all of it, as scrap.
      if (n === 8 && !(b.slabs.some((x: Slab) => x.w * x.h >= 6) && breakers(b) >= 1 && b.pending.length === 0)) return null;
      if (n === 9 && b.cells.filter((c) => c?.kind === "scrap").length !== hit.scrap) return null;
    }
    // Ripe at the end, and the raider sent nothing more in between.
    return st.boards[0]!.cells.every((c) => c?.kind !== "scrap") && st.boards[0]!.pending.length === 0 ? { log, tick: hit.tick } : null;
  });
  const f = await open(page, seed, cfg);
  await playLog(f, found.log.slice(0, 9));
  await hidePointer(page);
  const rest9 = found.log.slice(9);
  await clip(page, "swordfight", "scrap", async () => {
    // The count over the board is the attack waiting. It lands with the next drop.
    await stepTo(page, found.tick);
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 10_000, intervals: [100] }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    for (let n = 0; n < rest9.length; n++) {
      await drop(f, rest9[n]!, { tick: found.tick + (n + 1) * cfg.dropTicks });
      await rest(page, 700);
      // One drop before it ripens the scrap shows its color: the board, for the top of the page.
      if (n === rest9.length - 2) await still(page, "swordfight", "board", { region: f.g.region });
    }
  }, { tailMs: 1200, region: f.g.region });
});

test("swordfight: a break cancels the attack", async ({ page }) => {
  // The content raider again. The builder keeps a break one drop away: when the attack shows over
  // the board, the pair in hand shatters enough to cancel all of it.
  const { seed, found } = findSeed("sword-parry", (s) => {
    const hit = firstAttack(s);
    if (!hit || hit.scrap < 5 || hit.tick < 30) return null;
    const most = Math.min(16, Math.floor(hit.tick / cfg.dropTicks) - 2);
    const line = build(quiet, s, most, (t) => broke(t).length === 1 && t.r.points >= hit.scrap * cfg.attackPoints, 6);
    if (!line) return null;
    // The same line against the raider itself: the break lands with the attack waiting and cancels it whole.
    let st = createSwordfightGame(s, cfg);
    line.log.forEach((d, i) => {
      st = reduceSwordfight(st, { type: "place", col: d.col, rot: d.rot, tick: (i + 1) * cfg.dropTicks });
    });
    st = reduceSwordfight(st, { type: "place", col: line.hit.col, rot: line.hit.rot, tick: hit.tick + cfg.dropTicks });
    const sent = st.lastMove!.events.find((e) => e.type === "attack" && e.board === 0);
    return sent && sent.type === "attack" && sent.offset === hit.scrap && st.boards[0]!.pending.length === 0 ? { ...line, tick: hit.tick } : null;
  });
  const f = await open(page, seed, cfg);
  await playLog(f, found.log);
  await clip(page, "swordfight", "parry", async () => {
    await stepTo(page, found.tick);
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 10_000, intervals: [100] }).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    await drop(f, found.hit, { tick: found.tick + cfg.dropTicks, hand: true });
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 5000 }).toBe(0);
    await rest(page);
  }, { tailMs: 2000, region: f.g.region });
});
