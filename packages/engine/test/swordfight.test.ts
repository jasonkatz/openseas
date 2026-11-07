import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SWORDFIGHT_CONFIG,
  InvalidMoveError,
  advanceSwordfight,
  chooseSwordfightAiDrop,
  createSwordfightGame,
  hashSwordfightState,
  reduceSwordfight,
  replaySwordfight,
  swordfightColHeight,
  swordfightIdx,
  swordfightLandingCells,
  swordfightLegalDrops,
  swordfightPlaceIllegalReason,
  swordfightSpawnCol,
  type SwordBoard,
  type SwordCell,
  type SwordPiece,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightEvent,
  type SwordfightMove,
  type SwordfightState,
  swordfightScore,
} from "../src/index.js";

const cfg = DEFAULT_SWORDFIGHT_CONFIG;
/** A fight with nobody else in it: the foes are outside, so board rules can be tested alone. */
const alone: SwordfightConfig = { ...cfg, foes: [] };

const place = (col: number, rot: SwordRotation, tick: number): SwordfightMove => ({ type: "place", col, rot, tick });
const wait = (tick: number): SwordfightMove => ({ type: "wait", tick });

/**
 * Put a drawn board under the player: rows top to bottom, `.` empty, 0-5 a block of that color,
 * A-F a breaker of colors 0-5, `#` unripened wrack (ripens in one drop, into a checkerboard of
 * the colors above 0, so neighbouring wrack never ripens into one rectangle and never into the
 * color a drawn breaker of 0 is waiting for). No slabs: the first
 * resolution fuses whatever should be fused.
 */
function drawn(state: SwordfightState, rows: readonly string[], current?: [SwordPiece, SwordPiece], board = 0): SwordfightState {
  const c = state.config;
  const cells: Array<SwordCell | null> = new Array<SwordCell | null>(c.width * c.height).fill(null);
  let nextId = state.nextId;
  rows.forEach((line, r) => {
    const row = rows.length - 1 - r;
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      if (ch === ".") continue;
      let cell: SwordCell;
      if (ch === "#") cell = { id: nextId++, color: 1 + ((col + row) % (c.colors - 1)), kind: "wrack", ripen: 1, slab: 0 };
      else if (ch >= "A" && ch <= "F") cell = { id: nextId++, color: ch.charCodeAt(0) - 65, kind: "breaker", ripen: 0, slab: 0 };
      else cell = { id: nextId++, color: Number(ch), kind: "block", ripen: 0, slab: 0 };
      cells[swordfightIdx(c, col, row)] = cell;
    }
  });
  const b = state.boards[board]!;
  const boards = state.boards.slice();
  boards[board] = { ...b, cells, slabs: [], current: current ? { a: current[0], b: current[1] } : b.current };
  return { ...state, boards, nextId };
}

const blk = (color: number): SwordPiece => ({ color, breaker: false });
const brk = (color: number): SwordPiece => ({ color, breaker: true });

/** Random play: drops the player's pair at a random legal spot, with waits so the AI gets its turns. */
function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: SwordfightMove[]; state: SwordfightState } {
  let state = createSwordfightGame(seed, config);
  const moves: SwordfightMove[] = [];
  let tick = 0;
  for (const p of picks) {
    if (state.finished) break;
    tick += 1 + (p % 9);
    if (tick > config.maxTick) break;
    const drops = swordfightLegalDrops(config, state.boards[0]!);
    const m: SwordfightMove = p % 4 === 0 || drops.length === 0 || tick < state.boards[0]!.spawnedAt + config.dropTicks ? wait(tick) : { type: "place", tick, ...drops[p % drops.length]! };
    moves.push(m);
    state = reduceSwordfight(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 100_000 }), { minLength: 0, maxLength: 80 });

const neighbors = (c: SwordfightConfig, i: number): number[] => {
  const col = i % c.width;
  const row = Math.floor(i / c.width);
  const out: number[] = [];
  if (col > 0) out.push(i - 1);
  if (col < c.width - 1) out.push(i + 1);
  if (row > 0) out.push(i - c.width);
  if (row < c.height - 1) out.push(i + c.width);
  return out;
};

function expectBoardInvariants(c: SwordfightConfig, b: SwordBoard): void {
  // Settled: nothing floats. A slab rests on any one of its columns and may hang over a hole.
  for (let i = c.width; i < b.cells.length; i++) {
    const cell = b.cells[i];
    if (!cell || b.cells[i - c.width]) continue;
    expect(cell.slab, `cell ${i} floats`).not.toBe(0);
    const s = b.slabs.find((x) => x.id === cell.slab)!;
    const rests = s.row === 0 || Array.from({ length: s.w }, (_, k) => b.cells[swordfightIdx(c, s.col + k, s.row - 1)]).some((x) => x !== null);
    expect(rests, `slab ${s.id} floats`).toBe(true);
  }
  // Slabs are rectangles of one color whose cells all point back at them, and nothing else does.
  const slabIds = new Set(b.slabs.map((s) => s.id));
  expect(slabIds.size).toBe(b.slabs.length);
  for (const s of b.slabs) {
    expect(s.w).toBeGreaterThanOrEqual(2);
    expect(s.h).toBeGreaterThanOrEqual(2);
    for (let r = s.row; r < s.row + s.h; r++) {
      for (let col = s.col; col < s.col + s.w; col++) {
        const cell = b.cells[swordfightIdx(c, col, r)];
        expect(cell?.slab, `slab ${s.id} cell (${col},${r})`).toBe(s.id);
        expect(cell?.color).toBe(s.color);
        expect(cell?.kind).toBe("block");
      }
    }
  }
  let claimed = 0;
  for (const cell of b.cells) if (cell?.slab) claimed += 1;
  expect(claimed).toBe(b.slabs.reduce((n, s) => n + s.w * s.h, 0));
  // No breaker rests against its color: the resolution would have fired it.
  for (let i = 0; i < b.cells.length; i++) {
    const cell = b.cells[i];
    if (!cell || cell.kind !== "breaker") continue;
    for (const n of neighbors(c, i)) {
      const o = b.cells[n];
      if (o && o.kind !== "wrack") expect(o.color, `breaker ${cell.id} rests on its color`).not.toBe(cell.color);
    }
  }
  for (const cell of b.cells) {
    if (!cell) continue;
    // Wrack carries the color it will ripen into, so every cell has a color in range.
    expect(cell.color).toBeGreaterThanOrEqual(0);
    expect(cell.color).toBeLessThan(c.colors);
    if (cell.kind === "wrack") expect(cell.ripen).toBeGreaterThan(0);
    else expect(cell.ripen).toBe(0);
  }
  for (const p of b.pending) expect(p.wrack).toBeGreaterThan(0);
  if (b.out) expect(b.pending).toEqual([]);
  expect(b.pool).toBeGreaterThanOrEqual(0);
  expect(b.pool).toBeLessThan(c.attackPoints);
}

function expectInvariants(s: SwordfightState): void {
  for (const b of s.boards) expectBoardInvariants(s.config, b);
  expect(s.score).toBeGreaterThanOrEqual(0);
  expect(s.finished).toBe(s.outcome !== null);
  expect(s.tick).toBeLessThanOrEqual(s.config.maxTick);
}

describe("swordfight board", () => {
  it("starts empty with a pair in hand, one board per pirate, allies before foes", () => {
    const s = createSwordfightGame("x", { ...cfg, allies: [{ thinkTicks: 10, skill: 50, blade: 0 }], foes: [cfg.foes[0]!, cfg.foes[0]!] });
    expect(s.boards.map((b) => [b.mind, b.side])).toEqual([
      ["player", 0],
      ["ai", 0],
      ["ai", 1],
      ["ai", 1],
    ]);
    for (const b of s.boards) {
      expect(b.cells.every((c) => c === null)).toBe(true);
      expect(b.current.a.color).toBeLessThan(cfg.colors);
    }
    expect(s.boards[1]!.nextActTick).toBe(10);
  });

  it("drops a vertical pair to the floor of its column and a sideways pair to each column's height", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "..0..."], [blk(1), blk(2)]);
    const land = swordfightLandingCells(alone, s.boards[0]!.cells, 2, 1)!;
    expect(land).toEqual([swordfightIdx(alone, 2, 1), swordfightIdx(alone, 2, 2)]);
    const side = swordfightLandingCells(alone, s.boards[0]!.cells, 2, 0)!;
    expect(side).toEqual([swordfightIdx(alone, 2, 1), swordfightIdx(alone, 3, 0)]);
    s = reduceSwordfight(s, place(2, 0, 2));
    expect(s.boards[0]!.cells[swordfightIdx(alone, 2, 1)]?.color).toBe(1);
    expect(s.boards[0]!.cells[swordfightIdx(alone, 3, 0)]?.color).toBe(2);
    expect(s.boards[0]!.drops).toBe(1);
  });

  it("refuses a drop too soon after the pair appeared, into a full column, past a full column, or back in time", () => {
    let s = createSwordfightGame("x", alone);
    expect(swordfightPlaceIllegalReason(s, 2, 1, 0)).toBe("too soon");
    expect(swordfightPlaceIllegalReason(s, 2, 1, cfg.dropTicks)).toBeNull();
    expect(swordfightPlaceIllegalReason(s, 9, 1, 5)).toMatch(/bad drop/);
    expect(swordfightPlaceIllegalReason(s, 5, 0, 5)).toMatch(/no room/);
    const wall = ["...0..", "...1..", "...0..", "...1..", "...0..", "...1..", "...0..", "...1..", "...0..", "...1..", "...0..", "...1.."];
    s = drawn(s, wall);
    expect(swordfightPlaceIllegalReason(s, 3, 1, 5)).toMatch(/no room/);
    expect(swordfightPlaceIllegalReason(s, 4, 1, 5)).toMatch(/no way through/);
    expect(swordfightPlaceIllegalReason(s, 1, 1, 5)).toBeNull();
    s = reduceSwordfight(s, wait(5));
    expect(() => reduceSwordfight(s, wait(4))).toThrow(InvalidMoveError);
    expect(() => reduceSwordfight(s, wait(cfg.maxTick + 1))).toThrow(InvalidMoveError);
  });
});

describe("slabs", () => {
  it("fuses a two-by-two of one color, grows it by a strip, and joins two slabs that share a side", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "00....", "00...."], [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(4, 1, 2));
    expect(s.boards[0]!.slabs).toEqual([expect.objectContaining({ color: 0, col: 0, row: 0, w: 2, h: 2 })]);
    const fused = s.lastMove!.events.filter((e) => e.type === "fused");
    expect(fused).toHaveLength(1);
    // A strip of two above grows it to 2 by 3.
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "00....", "00....", "00...."], [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(4, 1, 4));
    expect(s.boards[0]!.slabs).toEqual([expect.objectContaining({ color: 0, col: 0, row: 0, w: 2, h: 3 })]);
    // Two 2x2 slabs side by side become one 4x2; a lone block beside a slab does not join.
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "00110.", "00110."], [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(4, 1, 6));
    expect(s.boards[0]!.slabs.map((x) => [x.color, x.col, x.row, x.w, x.h])).toEqual([
      [0, 0, 0, 2, 2],
      [1, 2, 0, 2, 2],
    ]);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "0000..", "0000.."], [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(4, 1, 8));
    expect(s.boards[0]!.slabs.map((x) => [x.color, x.col, x.row, x.w, x.h])).toEqual([[0, 0, 0, 4, 2]]);
  });

  it("never fuses breakers or wrack", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "0A.##.", "00.##."], [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(5, 1, 2));
    // The breaker of color 0 fired against the three blocks of color 0.
    expect(s.boards[0]!.slabs).toEqual([]);
    expect(s.boards[0]!.cells.filter((c) => c?.color === 0)).toEqual([]);
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack").length + s.boards[0]!.cells.filter((c) => c?.ripen === 0 && c.color >= 0 && c.id < 100).length).toBeGreaterThan(0);
  });
});

describe("breakers and chains", () => {
  it("a breaker that lands on its color shatters everything of that color connected to it, slabs scored as blocks", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "0011..", "0010.."], [brk(0), blk(3)]);
    s = reduceSwordfight(s, place(0, 1, 2));
    const broke = s.lastMove!.events.filter((e): e is Extract<SwordfightEvent, { type: "broke" }> => e.type === "broke");
    expect(broke).toHaveLength(1);
    expect(broke[0]!.chain).toBe(1);
    // The 2x2 slab of color 0 plus the breaker: slab points 4 * cellPoints + bonus 4*3/2 * slabBonus, breaker cellPoints.
    const expected = 4 * cfg.cellPoints + (cfg.slabBonus * 4 * 3) / 2 + cfg.cellPoints;
    expect(broke[0]!.points).toBe(expected);
    expect(broke[0]!.groups[0]!.cells).toHaveLength(5);
    // The lone 0 on the right was not connected and stays; the 1s dropped onto the floor.
    const b = s.boards[0]!;
    expect(b.cells[swordfightIdx(alone, 3, 0)]?.color).toBe(0);
    expect(b.cells[swordfightIdx(alone, 2, 0)]?.color).toBe(1);
    expect(b.cells[swordfightIdx(alone, 2, 1)]?.color).toBe(1);
    expect(b.cells[swordfightIdx(alone, 3, 1)]?.color).toBe(1);
    expect(b.cells[swordfightIdx(alone, 0, 0)]?.color).toBe(3);
    expect(b.points).toBe(expected);
    expect(s.score).toBe(expected);
  });

  it("a breaker that lands touching nothing of its color waits, and fires later when its color falls against it", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "1....."], [brk(0), blk(2)]);
    s = reduceSwordfight(s, place(2, 1, 2));
    expect(s.lastMove!.events.some((e) => e.type === "broke")).toBe(false);
    expect(s.boards[0]!.cells[swordfightIdx(alone, 2, 0)]?.kind).toBe("breaker");
    // Now a 0 lands beside it.
    s = { ...s, boards: [{ ...s.boards[0]!, current: { a: blk(0), b: blk(3) } }] };
    s = reduceSwordfight(s, place(3, 1, 4));
    const broke = s.lastMove!.events.filter((e) => e.type === "broke");
    expect(broke).toHaveLength(1);
    // The breaker and the 0 are gone; what was above each fell to the floor.
    expect(s.boards[0]!.cells[swordfightIdx(alone, 2, 0)]?.color).toBe(2);
    expect(s.boards[0]!.cells[swordfightIdx(alone, 3, 0)]?.color).toBe(3);
    expect(s.boards[0]!.cells[swordfightIdx(alone, 2, 1)]).toBeNull();
  });

  it("chains: a break lets a resting breaker fall onto its color, and the second step scores double", () => {
    let s = createSwordfightGame("x", alone);
    // Column 0: a breaker of color 1 sits on a 0, which the dropped breaker of 0 shatters; the
    // breaker of 1 then lands on the 1 below. Rows top to bottom.
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "B.....", "0.....", "12...."], [brk(0), blk(3)]);
    s = reduceSwordfight(s, place(1, 1, 2));
    const broke = s.lastMove!.events.filter((e): e is Extract<SwordfightEvent, { type: "broke" }> => e.type === "broke");
    expect(broke.map((e) => e.chain)).toEqual([1, 2]);
    expect(broke[1]!.points).toBe(2 * cfg.cellPoints * 2);
    expect(s.boards[0]!.bestChain).toBe(2);
    expect(s.boards[0]!.cells.filter((c) => c !== null).map((c) => c!.color)).toEqual([2, 3]);
  });

  it("two breakers firing in one step multiply by the count", () => {
    let s = createSwordfightGame("x", alone);
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "0..2.."], [brk(0), brk(2)]);
    // Sideways pair: a (breaker 0) in column 0 on the 0, b (breaker 2) in column 1... no: col 1 is empty.
    // Use a drawn pair over columns 0 and 1 with the 2 moved under column 1.
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "02...."], [brk(0), brk(2)]);
    s = reduceSwordfight(s, place(0, 0, 2));
    const broke = s.lastMove!.events.filter((e): e is Extract<SwordfightEvent, { type: "broke" }> => e.type === "broke");
    expect(broke).toHaveLength(1);
    expect(broke[0]!.groups).toHaveLength(2);
    expect(broke[0]!.points).toBe(4 * cfg.cellPoints * 2);
    expect(s.boards[0]!.cells.every((c) => c === null)).toBe(true);
  });
});

describe("wrack", () => {
  const attackCfg: SwordfightConfig = { ...alone, attackPoints: 10, cellPoints: 10, offset: true };

  it("points become wrack that leaves the fight when the foes are outside it, and the remainder carries over", () => {
    let s = createSwordfightGame("x", { ...attackCfg, attackPoints: 25 });
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "000..."], [brk(0), blk(3)]);
    s = reduceSwordfight(s, place(3, 0, 2));
    // 4 blocks * 10 = 40 points: one block of wrack at 25, 15 carried.
    const attack = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "attack" }> => e.type === "attack")!;
    expect(attack).toMatchObject({ to: -1, wrack: 1, offset: 0, blade: cfg.blade });
    expect(s.boards[0]!.pool).toBe(15);
    expect(s.boards[0]!.sent).toBe(1);
  });

  it("incoming wrack waits, lands at the next drop in the blade's columns, and ripens into blocks after ripenMoves drops", () => {
    let s = createSwordfightGame("x", { ...attackCfg, ripenMoves: 2 });
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 4, blade: 0, tick: 1 });
    expect(s.boards[0]!.pending).toEqual([{ wrack: 4, blade: 0 }]);
    expect(s.boards[0]!.pendingSince).toBe(1);
    s = reduceSwordfight(s, place(2, 1, 3));
    const landed = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "landed" }> => e.type === "landed")!;
    expect(landed.cells.map((c) => c % cfg.width)).toEqual([0, 1, 2, 3]);
    expect(s.boards[0]!.pending).toEqual([]);
    const wrack = s.boards[0]!.cells.filter((c) => c?.kind === "wrack");
    expect(wrack).toHaveLength(4);
    expect(wrack.every((c) => c!.ripen === 2)).toBe(true);
    s = reduceSwordfight(s, place(5, 1, 6));
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack").every((c) => c!.ripen === 1)).toBe(true);
    s = reduceSwordfight(s, place(5, 1, 9));
    const ripened = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "ripened" }> => e.type === "ripened")!;
    expect(ripened.ids).toHaveLength(4);
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack")).toHaveLength(0);
    for (const c of ripened.colors) expect(c).toBeLessThan(cfg.colors);
  });

  it("wrack is dealt the color it ripens into as it lands, told in the landed event, and keeps it", () => {
    let s = createSwordfightGame("x", { ...attackCfg, ripenMoves: 2 });
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 4, blade: 0, tick: 1 });
    s = reduceSwordfight(s, place(2, 1, 3));
    const landed = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "landed" }> => e.type === "landed")!;
    expect(landed.colors).toHaveLength(4);
    const dealt = new Map(landed.ids.map((id, k) => [id, landed.colors[k]!]));
    const wrack = s.boards[0]!.cells.filter((c): c is SwordCell => c?.kind === "wrack");
    expect(wrack).toHaveLength(4);
    for (const c of wrack) {
      expect(c.color).toBeGreaterThanOrEqual(0);
      expect(c.color).toBeLessThan(cfg.colors);
      expect(c.color).toBe(dealt.get(c.id));
    }
    s = reduceSwordfight(s, place(5, 1, 6));
    for (const c of s.boards[0]!.cells) if (c && dealt.has(c.id)) expect(c.color, "the color holds while it ripens").toBe(dealt.get(c.id));
    s = reduceSwordfight(s, place(5, 1, 9));
    const ripened = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "ripened" }> => e.type === "ripened")!;
    for (let k = 0; k < ripened.ids.length; k++) expect(ripened.colors[k], "it ripens into the color it was dealt").toBe(dealt.get(ripened.ids[k]!));
  });

  it("waiting wrack lands on its own after landAfterTicks, on a wait", () => {
    let s = createSwordfightGame("x", { ...attackCfg, landAfterTicks: 5 });
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 3, blade: 0, tick: 2 });
    s = reduceSwordfight(s, wait(6));
    expect(s.boards[0]!.pending).toHaveLength(1);
    s = reduceSwordfight(s, wait(7));
    expect(s.boards[0]!.pending).toEqual([]);
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack")).toHaveLength(3);
    const landed = s.lastMove!.events.find((e) => e.type === "landed")!;
    expect(landed.tick).toBe(7);
  });

  it("lands at most incomingCapRows rows at once and keeps the rest waiting", () => {
    let s = createSwordfightGame("x", { ...attackCfg, incomingCapRows: 1 });
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 9, blade: 0, tick: 1 });
    s = reduceSwordfight(s, place(2, 1, 3));
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack")).toHaveLength(6);
    expect(s.boards[0]!.pending).toEqual([{ wrack: 3, blade: 0 }]);
  });

  it("wrack sent first cancels wrack waiting on the sender's board", () => {
    let s = createSwordfightGame("x", attackCfg);
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 3, blade: 0, tick: 1 });
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "000..."], [brk(0), blk(3)]);
    s = reduceSwordfight(s, place(3, 0, 3));
    // 40 points at 10 a block: four blocks of wrack; three cancel what was waiting, one leaves.
    const attack = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "attack" }> => e.type === "attack")!;
    expect(attack).toMatchObject({ to: -1, wrack: 1, offset: 3 });
    expect(s.boards[0]!.pending).toEqual([]);
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack")).toHaveLength(0);
  });

  it("without offsetting, wrack goes over and what was waiting lands", () => {
    let s = createSwordfightGame("x", { ...attackCfg, offset: false });
    s = reduceSwordfight(s, { type: "incoming", board: 0, wrack: 3, blade: 0, tick: 1 });
    s = drawn(s, ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "000..."], [brk(0), blk(3)]);
    s = reduceSwordfight(s, place(3, 0, 3));
    const attack = s.lastMove!.events.find((e): e is Extract<SwordfightEvent, { type: "attack" }> => e.type === "attack")!;
    expect(attack).toMatchObject({ to: -1, wrack: 4, offset: 0 });
    expect(s.boards[0]!.cells.filter((c) => c?.kind === "wrack")).toHaveLength(3);
  });

  it("refuses incoming wrack when the foes are in the fight, and bad incoming", () => {
    const s = createSwordfightGame("x", cfg);
    expect(() => reduceSwordfight(s, { type: "incoming", board: 0, wrack: 2, blade: 0, tick: 1 })).toThrow(/its own foes/);
    const a = createSwordfightGame("x", alone);
    expect(() => reduceSwordfight(a, { type: "incoming", board: 0, wrack: 0, blade: 0, tick: 1 })).toThrow(InvalidMoveError);
    expect(() => reduceSwordfight(a, { type: "incoming", board: 0, wrack: 2, blade: 9, tick: 1 })).toThrow(InvalidMoveError);
    expect(() => reduceSwordfight(a, { type: "incoming", board: 3, wrack: 2, blade: 0, tick: 1 })).toThrow(InvalidMoveError);
  });
});

describe("the fight", () => {
  it("a covered entry puts the board out, and the only board on a side out loses the fight", () => {
    let s = createSwordfightGame("x", alone);
    // Ten blocks in the entry column: the pair rests in the top two cells and covers the entry.
    const tall = ["......", "......", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1..."];
    s = drawn(s, tall, [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(2, 1, 2));
    expect(s.boards[0]!.out).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.outcome).toBe("lost");
    expect(s.lastMove!.events.map((e) => e.type)).toContain("out");
    expect(() => reduceSwordfight(s, wait(5))).toThrow(/finished/);
  });

  it("an upright pair in a column with one free cell rests its lower half in the top cell; the upper half falls away, and the next pair finds the entry covered", () => {
    let s = createSwordfightGame("x", alone);
    const tall = ["......", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1..."];
    s = drawn(s, tall, [blk(2), blk(3)]);
    expect(swordfightLandingCells(alone, s.boards[0]!.cells, 2, 1)).toEqual([swordfightIdx(alone, 2, 11), -1]);
    expect(swordfightLandingCells(alone, s.boards[0]!.cells, 2, 3)).toEqual([-1, swordfightIdx(alone, 2, 11)]);
    expect(swordfightPlaceIllegalReason(s, 2, 1, 5)).toBeNull();
    s = reduceSwordfight(s, place(2, 1, 5));
    const placed = s.lastMove!.events.find((e) => e.type === "placed");
    expect(placed && placed.type === "placed" ? placed.cells : null).toEqual([swordfightIdx(alone, 2, 11), -1]);
    expect(s.boards[0]!.cells[swordfightIdx(alone, 2, 11)]?.color).toBe(2);
    expect(s.boards[0]!.cells.filter((c) => c?.color === 3)).toHaveLength(0);
    expect(s.boards[0]!.out).toBe(true);
    expect(s.outcome).toBe("lost");
  });

  it("only the top cell of the entry column counts; a board with room beside the entry fights on, and the last free cell still takes a drop", () => {
    let s = createSwordfightGame("x", alone);
    // Eleven blocks in the entry column: no vertical drop there, but sideways drops beside it.
    const tall = ["......", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1..."];
    s = drawn(s, tall, [blk(2), blk(3)]);
    s = reduceSwordfight(s, place(0, 0, 2));
    expect(s.boards[0]!.out).toBe(false);
    expect(swordfightLegalDrops(alone, s.boards[0]!).length).toBeGreaterThan(0);
    // Every cell full but the entry's top cell and one far away: wrack lands in the far one (the
    // dirk tries columns 0, 5, 1, 4 first), and the pair can still drop into the entry's last cell.
    const rows: string[] = [];
    for (let r = 0; r < 12; r++) rows.push(r === 0 ? "01.1.1" : "010101");
    let t = createSwordfightGame("x", { ...alone, landAfterTicks: 2 });
    t = drawn(t, rows, [blk(2), blk(3)]);
    t = reduceSwordfight(t, { type: "incoming", board: 0, wrack: 1, blade: 2, tick: 1 });
    t = reduceSwordfight(t, wait(3));
    expect(t.boards[0]!.cells[swordfightIdx(alone, 4, 11)]?.kind).toBe("wrack");
    expect(t.boards[0]!.cells[swordfightIdx(alone, 2, 11)]).toBeNull();
    expect(t.boards[0]!.out).toBe(false);
    expect(swordfightLegalDrops(alone, t.boards[0]!)).toEqual([
      { col: 2, rot: 1 },
      { col: 2, rot: 3 },
    ]);
    t = reduceSwordfight(t, place(2, 1, 5));
    expect(t.boards[0]!.out).toBe(true);
  });

  it("the server's word ends a fight whose foes are outside it, with the win's points; the player may yield", () => {
    let s = createSwordfightGame("x", alone);
    s = reduceSwordfight(s, { type: "end", won: true, tick: 3 });
    expect(s.outcome).toBe("won");
    expect(s.score).toBe(cfg.winPoints);
    let y = createSwordfightGame("x", alone);
    y = reduceSwordfight(y, { type: "end", won: false, tick: 3 });
    expect(y.outcome).toBe("lost");
    expect(y.score).toBe(0);
    const inFight = createSwordfightGame("x", cfg);
    expect(() => reduceSwordfight(inFight, { type: "end", won: true, tick: 3 })).toThrow(/beat them/);
    expect(reduceSwordfight(inFight, { type: "end", won: false, tick: 3 }).outcome).toBe("lost");
  });

  it("an AI foe drops on its cadence, attacks the player, and can be beaten", () => {
    const quick: SwordfightConfig = { ...cfg, foes: [{ thinkTicks: 5, skill: 100, blade: 0 }] };
    let s = createSwordfightGame("cadence", quick);
    s = reduceSwordfight(s, wait(4));
    expect(s.boards[1]!.drops).toBe(0);
    s = reduceSwordfight(s, wait(5));
    expect(s.boards[1]!.drops).toBe(1);
    expect(s.boards[1]!.nextActTick).toBe(10);
    s = reduceSwordfight(s, wait(31));
    expect(s.boards[1]!.drops).toBe(6);
    expectInvariants(s);
    // Bury the foe: cover its entry; its next drop, wherever it goes, finds the entry covered.
    const tall = ["..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1...", "..0...", "..1..."];
    s = drawn(s, tall, undefined, 1);
    s = reduceSwordfight(s, wait(35));
    expect(s.boards[1]!.out).toBe(true);
    expect(s.outcome).toBe("won");
    expect(s.score).toBe(s.boards[0]!.points + cfg.winPoints);
  });

  it("an AI foe's wrack waits on the player's board and lands at the player's next drop", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        let s = createSwordfightGame(seed, { ...cfg, foes: [{ thinkTicks: 3, skill: 100, blade: 2 }], attackPoints: 10 });
        let tick = 0;
        let attacked = false;
        for (let i = 0; i < 60 && !s.finished && !attacked; i++) {
          tick += 3;
          s = reduceSwordfight(s, wait(tick));
          attacked = s.lastMove!.events.some((e) => e.type === "attack" && e.board === 1 && e.to === 0);
        }
        if (!attacked) return;
        expect(s.boards[0]!.pending.length).toBeGreaterThan(0);
        expect(s.boards[0]!.pending[0]!.blade).toBe(2);
      }),
      { numRuns: 20 },
    );
  });

  it("allies fight beside the player and foes spread their attacks over the side with the least on it", () => {
    const team: SwordfightConfig = { ...cfg, allies: [{ thinkTicks: 4, skill: 100, blade: 0 }], foes: [{ thinkTicks: 3, skill: 100, blade: 0 }], attackPoints: 10 };
    let s = createSwordfightGame("team", team);
    let tick = 0;
    for (let i = 0; i < 80 && !s.finished; i++) {
      tick += 2;
      s = reduceSwordfight(s, wait(tick));
      expectInvariants(s);
    }
    const attacks = s.boards.map(() => 0);
    // Replay to count where the foe's wrack went.
    let r = createSwordfightGame("team", team);
    tick = 0;
    for (let i = 0; i < 80 && !r.finished; i++) {
      tick += 2;
      r = reduceSwordfight(r, wait(tick));
      for (const e of r.lastMove!.events) if (e.type === "attack" && e.board === 2 && e.to >= 0) attacks[e.to]! += 1;
    }
    expect(attacks[2]).toBe(0);
    expect(attacks[0]! + attacks[1]!).toBeGreaterThan(0);
  });

  it("the AI never picks a drop the rules refuse, and at full skill picks the same drop every time", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        const b = state.boards[1]!;
        if (b.out) return;
        const legal = new Set(swordfightLegalDrops(cfg, b).map((d) => `${d.col},${d.rot}`));
        const a = chooseSwordfightAiDrop(cfg, { ...b, ai: { ...b.ai!, skill: 100 } }, state.rng);
        const c = chooseSwordfightAiDrop(cfg, { ...b, ai: { ...b.ai!, skill: 100 } }, { a: 9, b: 9, c: 9, d: 9 });
        if (legal.size === 0) {
          expect(a.drop).toBeNull();
          return;
        }
        expect(legal.has(`${a.drop!.col},${a.drop!.rot}`)).toBe(true);
        expect(c.drop).toEqual(a.drop);
      }),
      { numRuns: 30 },
    );
  });
});

describe("swordfight determinism (ADR 0003)", () => {
  it("same seed and log give the same state and hash, on any config", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replaySwordfight(seed, a.moves);
        expect(hashSwordfightState(b)).toBe(hashSwordfightState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 40 },
    );
  });

  it("holds every invariant after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSwordfightGame(seed);
        let tick = 0;
        for (const p of picks) {
          if (state.finished) break;
          tick += 1 + (p % 9);
          if (tick > cfg.maxTick) break;
          const drops = swordfightLegalDrops(cfg, state.boards[0]!);
          const m: SwordfightMove = p % 4 === 0 || drops.length === 0 || tick < state.boards[0]!.spawnedAt + cfg.dropTicks ? wait(tick) : { type: "place", tick, ...drops[p % drops.length]! };
          const prev = state;
          state = reduceSwordfight(state, m);
          expectInvariants(state);
          expect(state.tick).toBe(tick);
          expect(state.moveCount).toBe(prev.moveCount + 1);
          expect(state.score).toBeGreaterThanOrEqual(prev.score);
          if (m.type === "place") expect(state.boards[0]!.drops === prev.boards[0]!.drops + 1 || state.boards[0]!.out || state.finished).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("advancing to a tick shows the same boards as logging a wait there", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 40 }), (seed, picks, ahead) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const tick = Math.min(cfg.maxTick, state.tick + ahead);
        const shown = advanceSwordfight(state, tick);
        const logged = reduceSwordfight(state, wait(tick));
        expect(shown.boards).toEqual(logged.boards);
        expect(shown.score).toBe(logged.score);
        expect(shown.moveCount).toBe(state.moveCount);
        expect(advanceSwordfight(state, state.tick)).toBe(state);
      }),
      { numRuns: 30 },
    );
  });

  it("a different drop gives a different hash", () => {
    const s = createSwordfightGame("h", alone);
    const a = reduceSwordfight(s, place(1, 1, 3));
    const b = reduceSwordfight(s, place(3, 1, 3));
    expect(hashSwordfightState(a)).not.toBe(hashSwordfightState(b));
  });

  it("rejects a config the fight cannot be played on", () => {
    expect(() => createSwordfightGame("x", { ...cfg, colors: 2 })).toThrow(/invalid/);
    expect(() => createSwordfightGame("x", { ...cfg, blade: 5 })).toThrow(/invalid/);
    expect(() => createSwordfightGame("x", { ...cfg, player: false })).toThrow(/invalid/);
    expect(() => createSwordfightGame("x", { ...cfg, blades: [{ id: "x", columns: [9] }] })).toThrow(/invalid/);
    expect(() => createSwordfightGame("x", { ...cfg, player: false, allies: [cfg.foes[0]!], foes: [] })).not.toThrow();
  });

  it("columns and heights read as drawn", () => {
    const s = drawn(createSwordfightGame("x", alone), ["......", "......", "......", "......", "......", "......", "......", "......", "......", "......", "0.....", "01...."]);
    expect(swordfightColHeight(alone, s.boards[0]!.cells, 0)).toBe(2);
    expect(swordfightColHeight(alone, s.boards[0]!.cells, 1)).toBe(1);
    expect(swordfightSpawnCol(alone)).toBe(2);
  });
});

describe("swordfight scoring", () => {
  it("scores attack per minute over at least the floor, scaled by the tier, and a win's band above every loss", () => {
    const c: SwordfightConfig = { ...cfg, tickMs: 200, winPoints: 5000, minRateSeconds: 60, scorePercent: 100 };
    // 1200 points over two minutes (600 ticks of 200 ms) is 600 a minute.
    expect(swordfightScore(c, 1200, 600, null)).toBe(600);
    expect(swordfightScore(c, 1200, 600, "won")).toBe(5600);
    expect(swordfightScore(c, 1200, 600, "lost")).toBe(600);
    // A short fight still counts the full minute.
    expect(swordfightScore(c, 300, 50, "lost")).toBe(300);
    // The tier scales the rate, never the band.
    expect(swordfightScore({ ...c, scorePercent: 200 }, 1200, 600, "won")).toBe(6200);
    // No loss reaches the band, however hot.
    expect(swordfightScore(c, 1_000_000, 300, "lost")).toBe(4999);
  });

  it("a fight's score is in the win band exactly when it was won", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.array(fc.nat({ max: 10_000 }), { minLength: 1, maxLength: 60 }), (seed, picks) => {
        const { state } = playRandom(seed, picks);
        expect(state.score >= state.config.winPoints).toBe(state.outcome === "won");
        expect(state.score).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 30 },
    );
  });
});

