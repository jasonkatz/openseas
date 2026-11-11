import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  advanceSwordfight,
  createSwordfightGame,
  reduceSwordfight,
  swordfightApplyDrop,
  swordfightColHeight,
  swordfightLegalDrops,
  swordfightPairAt,
  swordfightSpawnCol,
  type Slab,
  type SwordBoard,
  type SwordCell,
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

const hudNumber = async (page: Page, id: string): Promise<number> => Number.parseInt((await page.getByTestId(id).textContent()) ?? "0", 10);
const drops = (page: Page): Promise<number> => hudNumber(page, "hud-moves");

/** The fight's tick, from the bench's clock. */
async function tickNow(page: Page): Promise<number> {
  const m = /tick (\d+)/.exec((await page.getByTestId("clock-readout").textContent()) ?? "");
  return m ? Number(m[1]) : 0;
}

/** The falling pair as the canvas publishes it: its pivot's column and its rotation. Null between pairs. */
async function falling(page: Page): Promise<{ pc: number; rot: SwordRotation } | null> {
  const [pc, rot] = (await canvasAttr(page, "swordfight", "data-falling")).split(",").map(Number);
  return pc === undefined || rot === undefined || Number.isNaN(rot) ? null : { pc, rot: rot as SwordRotation };
}

async function pairInHand(page: Page): Promise<{ pc: number; rot: SwordRotation }> {
  await expect.poll(() => falling(page), { timeout: 15_000 }).not.toBeNull();
  return (await falling(page))!;
}

/** The renderer steers the pivot half; the engine's anchor is the left column of a pair lying down. */
const pivotOf = (d: Drop): number => (d.rot === 2 ? d.col + 1 : d.col);
/** Clockwise turns go 1, 0, 3, 2. */
const TURNS: readonly SwordRotation[] = [1, 0, 3, 2];

/** Steer and turn the pair with the keyboard until it hangs over the drop. */
async function steer(page: Page, d: Drop): Promise<void> {
  // A key does nothing while the last pair is still landing, so this asks again until the pair is there.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const f = await pairInHand(page);
    if (f.rot === d.rot && f.pc === pivotOf(d)) return;
    if (f.rot !== d.rot) await page.keyboard.press((TURNS.indexOf(d.rot) - TURNS.indexOf(f.rot) + 4) % 4 === 3 ? "ArrowDown" : "ArrowUp");
    else await page.keyboard.press(f.pc < pivotOf(d) ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(50);
  }
  throw new Error(`could not steer to ${d.col},${d.rot}`);
}

/** Hold the hurry key until the engine has taken the pair. */
async function hurry(page: Page): Promise<void> {
  const before = await drops(page);
  await page.keyboard.down(" ");
  await expect.poll(() => drops(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await page.keyboard.up(" ");
}

/** One drop by keyboard. */
async function put(page: Page, d: Drop): Promise<void> {
  await steer(page, d);
  await hurry(page);
}

/** Swipe down on the board and hold until the pair lands: the touch way to hurry. */
async function hurryByHand(page: Page, g: Geom): Promise<void> {
  const before = await drops(page);
  const x = g.x + g.cell * (W / 2);
  const y = g.y + g.cell * (H - 6);
  await glide(page, x, y);
  await page.mouse.down();
  await glide(page, x, y + g.cell * 1.6, 160);
  await expect.poll(() => drops(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await page.mouse.up();
}

/** One drop as a thumb makes it: tap to turn, drag sideways to steer, swipe down and hold to hurry. */
async function putByHand(page: Page, d: Drop, g: Geom): Promise<void> {
  const y = g.y + g.cell * (H - 6);
  let f = await pairInHand(page);
  const turns = (TURNS.indexOf(d.rot) - TURNS.indexOf(f.rot) + 4) % 4;
  for (let n = 0; n < turns; n++) {
    await tapAt(page, g.x + g.cell * (W / 2), y);
    await page.waitForTimeout(160);
  }
  f = await pairInHand(page);
  const dx = pivotOf(d) - f.pc;
  if (dx !== 0) {
    const x = g.x + g.cell * (W / 2 - dx / 2);
    await glide(page, x, y);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await glide(page, x + dx * g.cell, y, 320);
    await page.waitForTimeout(90);
    await page.mouse.up();
    await page.waitForTimeout(160);
  }
  // A turn against a wall kicks the pair sideways: the keys put right whatever the hand left.
  await steer(page, d);
  await hurryByHand(page, g);
}

/** Play the builder's drops by keyboard and let the board land. */
async function playLog(page: Page, log: readonly Drop[]): Promise<void> {
  for (const d of log) await put(page, d);
  await settled(page, "swordfight", 4000);
  await page.waitForTimeout(400);
}

/**
 * Play the builder's drops against the content raider so the last lands a few seconds before the
 * tick the raider's first attack arrives: each waits for its share of the time, then hurries.
 * Nothing breaks, so nothing is sent and the raider's fight is the one Node played alone.
 */
async function playUntil(page: Page, log: readonly Drop[], attackTick: number): Promise<void> {
  for (let i = 0; i < log.length; i++) {
    await steer(page, log[i]!);
    const gate = Math.floor(((attackTick - LEAD_TICKS) * (i + 1)) / log.length) - 3;
    await expect.poll(() => tickNow(page), { timeout: 90_000, intervals: [100] }).toBeGreaterThanOrEqual(gate);
    await hurry(page);
  }
}
/** The builder is done this long before the attack, and each of its drops has at least `PACE_TICKS`. */
const LEAD_TICKS = 16;
const PACE_TICKS = 12;

/** The board the page publishes, as cells the engine can drop on. Scrap keeps its secret, and slabs are loose blocks. */
function cellsOf(board: string): Array<SwordCell | null> {
  const cells = new Array<SwordCell | null>(W * H).fill(null);
  for (let i = 0; i < board.length; i++) {
    const ch = board[i]!;
    if (ch === ".") continue;
    const at = (H - 1 - Math.floor(i / W)) * W + (i % W);
    if (ch === "#") cells[at] = { id: i + 1, color: 0, kind: "scrap", ripen: 99, slab: 0 };
    else if (ch >= "A") cells[at] = { id: i + 1, color: ch.charCodeAt(0) - 65, kind: "breaker", ripen: 0, slab: 0 };
    else cells[at] = { id: i + 1, color: Number(ch), kind: "block", ripen: 0, slab: 0 };
  }
  return cells;
}

/** A drop that breaks nothing on the board as the page shows it, for the pair the fight's stream deals next. */
async function quietDrop(page: Page, seed: string): Promise<Drop> {
  const s = createSwordfightGame(seed, cfg);
  const n = await drops(page);
  const board: SwordBoard = { ...s.boards[0]!, cells: cellsOf(await boardString(page, "swordfight")), current: swordfightPairAt(cfg, s.deal, n) };
  const d = builderDrop(cfg, board);
  if (!d) throw new Error("every drop breaks");
  return d;
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
  await openLab(page, "swordfight", { seed, config: { foes: ASLEEP } });
  const g = await geom(page);
  await playLog(page, found.log);
  await clip(page, "swordfight", "first-break", async () => {
    await putByHand(page, found.hit, g);
    await settled(page, "swordfight", 4000);
  }, { tailMs: 1300, region: g.region });
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
  await openLab(page, "swordfight", { seed, config: { foes: ASLEEP } });
  const g = await geom(page);
  await playLog(page, found.log);
  await clip(page, "swordfight", "slab", async () => {
    await putByHand(page, found.hit, g);
    await settled(page, "swordfight", 4000);
    await page.waitForTimeout(500);
    await putByHand(page, found.grow, g);
    await settled(page, "swordfight", 4000);
  }, { tailMs: 1300, region: g.region });
});

test("swordfight: a big slab shatters", async ({ page }) => {
  // The builder grows a slab and parks its breakers. Then one breaker takes a slab of eight or more.
  const { seed, found } = findSeed("sword-slab", (s) =>
    build(quiet, s, 18, (t, st) => {
      const b = broke(t);
      return b.length === 1 && b[0]!.groups.length === 1 && slabBlocks(st.boards[0]!, b[0]!.groups[0]!.cells) >= 8;
    }),
  );
  await openLab(page, "swordfight", { seed, config: { foes: ASLEEP } });
  const g = await geom(page);
  await playLog(page, found.log);
  await clip(page, "swordfight", "big-break", async () => {
    await putByHand(page, found.hit, g);
    await settled(page, "swordfight", 5000);
  }, { tailMs: 2600, region: g.region });
});

test("swordfight: a chain", async ({ page }) => {
  // One breaker clears a color, what was above falls, and a second breaker that was waiting takes a slab on chain 2.
  const { seed, found } = findSeed("sword-chain", (s) =>
    build(quiet, s, 22, (t, st) => {
      const b = broke(t);
      return b.length === 2 && b[0]!.groups.length === 1 && b[1]!.groups.length === 1 && b[0]!.groups[0]!.cells.length >= 3 && slabBlocks(st.boards[0]!, b[1]!.groups[0]!.cells) >= 6;
    }),
  );
  await openLab(page, "swordfight", { seed, config: { foes: ASLEEP } });
  const g = await geom(page);
  await playLog(page, found.log);
  await still(page, "swordfight", "chain-before", { region: g.region });
  await clip(page, "swordfight", "chain", async () => {
    await putByHand(page, found.hit, g);
    await settled(page, "swordfight", 6000);
  }, { tailMs: 2600, region: g.region });
});

test("swordfight: scrap lands and ripens, and the board", async ({ page }) => {
  // The content raider. Its first attack is a big one and comes late enough for the builder to have
  // a slab down. The builder's drops send nothing, so the raider plays the fight Node saw.
  const { seed, found } = findSeed("sword-scrap", (s) => {
    const hit = firstAttack(s);
    if (!hit || hit.scrap < 8 || hit.tick < 150 || hit.tick > 260) return null;
    const count = Math.min(9, Math.floor((hit.tick - LEAD_TICKS) / PACE_TICKS));
    let st = createSwordfightGame(s, quiet);
    const log: Drop[] = [];
    for (let n = 0; n < count; n++) {
      const d = builderDrop(quiet, st.boards[0]!);
      if (!d) return null;
      log.push({ col: d.col, rot: d.rot });
      st = reduceSwordfight(st, { type: "place", col: d.col, rot: d.rot, tick: st.tick + quiet.dropTicks });
    }
    const b = st.boards[0]!;
    return b.slabs.some((x: Slab) => x.w * x.h >= 6) && breakers(b) >= 1 ? { log, tick: hit.tick } : null;
  });
  await openLab(page, "swordfight", { seed });
  const g = await geom(page);
  await playUntil(page, found.log, found.tick);
  await hidePointer(page);
  await clip(page, "swordfight", "scrap", async () => {
    // The count over the board is the attack waiting. It lands with the next drop.
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 30_000, intervals: [100] }).toBeGreaterThan(0);
    await page.waitForTimeout(900);
    await put(page, await quietDrop(page, seed));
    await expect.poll(() => boardString(page, "swordfight"), { timeout: 10_000 }).toContain("#");
    await settled(page, "swordfight", 3000);
    await page.waitForTimeout(700);
    // One drop later the scrap shows its color.
    await put(page, await quietDrop(page, seed));
    await settled(page, "swordfight", 3000);
    await page.waitForTimeout(500);
    await still(page, "swordfight", "board", { region: g.region });
    await page.waitForTimeout(400);
    // And one more turns it into blocks.
    await put(page, await quietDrop(page, seed));
    await settled(page, "swordfight", 3000);
  }, { tailMs: 1200, region: g.region });
});

test("swordfight: a break cancels the attack", async ({ page }) => {
  // The content raider again. The builder keeps a break one drop away: when the attack shows over
  // the board, the pair in hand shatters enough to cancel all of it.
  const { seed, found } = findSeed("sword-parry", (s) => {
    const hit = firstAttack(s);
    if (!hit || hit.scrap < 5 || hit.tick < 130 || hit.tick > 260) return null;
    const most = Math.floor((hit.tick - LEAD_TICKS) / PACE_TICKS);
    const line = build(quiet, s, most, (t) => broke(t).length === 1 && t.r.points >= hit.scrap * cfg.attackPoints, most);
    if (!line) return null;
    // The same line against the raider itself: the break lands with the attack waiting and cancels it whole.
    let st = createSwordfightGame(s, cfg);
    line.log.forEach((d, i) => {
      st = reduceSwordfight(st, { type: "place", col: d.col, rot: d.rot, tick: Math.floor(((hit.tick - LEAD_TICKS) * (i + 1)) / line.log.length) });
    });
    st = reduceSwordfight(st, { type: "place", col: line.hit.col, rot: line.hit.rot, tick: hit.tick + 4 });
    const sent = st.lastMove!.events.find((e) => e.type === "attack" && e.board === 0);
    return sent && sent.type === "attack" && sent.offset === hit.scrap && st.boards[0]!.pending.length === 0 ? { ...line, tick: hit.tick } : null;
  });
  await openLab(page, "swordfight", { seed });
  const g = await geom(page);
  await playUntil(page, found.log, found.tick);
  await steer(page, found.hit);
  await clip(page, "swordfight", "parry", async () => {
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 30_000, intervals: [100] }).toBeGreaterThan(0);
    await page.waitForTimeout(1100);
    await steer(page, found.hit);
    await hurryByHand(page, g);
    await expect.poll(() => hudNumber(page, "hud-incoming"), { timeout: 5000 }).toBe(0);
    await settled(page, "swordfight", 5000);
  }, { tailMs: 2200, region: g.region });
});
