import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import { chooseAiDrop } from "./ai.js";
import {
  DEFAULT_SWORDFIGHT_CONFIG,
  type PendingAttack,
  type Slab,
  type SwordAiSpec,
  type SwordBoard,
  type SwordCell,
  type SwordPair,
  type SwordPiece,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightEvent,
  type SwordfightMove,
  type SwordfightMoveReport,
  type SwordfightOutcome,
  type SwordfightState,
} from "./types.js";

export const idx = (cfg: SwordfightConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: SwordfightConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: SwordfightConfig, i: number): number => Math.floor(i / cfg.width);

type Cells = Array<SwordCell | null>;

const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

// ---- config

function validAi(cfg: SwordfightConfig, a: SwordAiSpec): boolean {
  return typeof a === "object" && a !== null && int(a.thinkTicks, 1, 10_000) && int(a.skill, 0, 100) && int(a.blade, 0, cfg.blades.length - 1);
}

export function validateConfig(cfg: SwordfightConfig): void {
  const ok =
    int(cfg.width, 4, 10) &&
    int(cfg.height, 6, 20) &&
    int(cfg.colors, 3, 6) &&
    int(cfg.breakerPermille, 0, 1000) &&
    int(cfg.ripenMoves, 1, 20) &&
    int(cfg.cellPoints, 0, 1000) &&
    int(cfg.slabBonus, 0, 1000) &&
    int(cfg.attackPoints, 1, 100_000) &&
    typeof cfg.offset === "boolean" &&
    int(cfg.landAfterTicks, 1, 10_000) &&
    int(cfg.incomingCapRows, 1, cfg.height) &&
    Array.isArray(cfg.blades) &&
    cfg.blades.length >= 1 &&
    cfg.blades.length <= 16 &&
    cfg.blades.every((b) => typeof b === "object" && b !== null && typeof b.id === "string" && Array.isArray(b.columns) && b.columns.length >= 1 && b.columns.length <= 64 && b.columns.every((c: unknown) => int(c, 0, cfg.width - 1))) &&
    typeof cfg.player === "boolean" &&
    int(cfg.blade, 0, cfg.blades.length - 1) &&
    Array.isArray(cfg.allies) &&
    cfg.allies.length <= 8 &&
    cfg.allies.every((a) => validAi(cfg, a)) &&
    Array.isArray(cfg.foes) &&
    cfg.foes.length <= 8 &&
    cfg.foes.every((a) => validAi(cfg, a)) &&
    (cfg.player || cfg.allies.length > 0) &&
    int(cfg.winPoints, 0, 1_000_000) &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.dropTicks, 0, 1000) &&
    int(cfg.fallTicks, 1, 1000) &&
    int(cfg.maxTick, 1, 1_000_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid swordfight config");
}

// ---- lifecycle

function dealPiece(cfg: SwordfightConfig, rng: PrngState): { piece: SwordPiece; rng: PrngState } {
  const c = nextInt(rng, cfg.colors);
  const b = nextChance(c.state, cfg.breakerPermille, 1000);
  return { piece: { color: c.value, breaker: b.value }, rng: b.state };
}

function dealPair(cfg: SwordfightConfig, rng: PrngState): { pair: SwordPair; rng: PrngState } {
  const a = dealPiece(cfg, rng);
  const b = dealPiece(cfg, a.rng);
  return { pair: { a: a.piece, b: b.piece }, rng: b.rng };
}

function newBoard(cfg: SwordfightConfig, mind: "player" | "ai", side: 0 | 1, ai: SwordAiSpec | null, blade: number, rng: PrngState): { board: SwordBoard; rng: PrngState } {
  const p1 = dealPair(cfg, rng);
  const p2 = dealPair(cfg, p1.rng);
  return {
    board: {
      mind,
      side,
      ai,
      blade,
      cells: new Array<SwordCell | null>(cfg.width * cfg.height).fill(null),
      slabs: [],
      current: p1.pair,
      next: p2.pair,
      spawnedAt: 0,
      pending: [],
      pendingSince: -1,
      cursor: 0,
      drops: 0,
      points: 0,
      pool: 0,
      sent: 0,
      bestChain: 0,
      out: false,
      nextActTick: ai ? ai.thinkTicks : -1,
    },
    rng: p2.rng,
  };
}

export function createSwordfightGame(seed: string, config: SwordfightConfig = DEFAULT_SWORDFIGHT_CONFIG): SwordfightState {
  validateConfig(config);
  let rng = seedFromString(`swordfight:${seed}`);
  const boards: SwordBoard[] = [];
  if (config.player) {
    const b = newBoard(config, "player", 0, null, config.blade, rng);
    boards.push(b.board);
    rng = b.rng;
  }
  for (const ai of config.allies) {
    const b = newBoard(config, "ai", 0, ai, ai.blade, rng);
    boards.push(b.board);
    rng = b.rng;
  }
  for (const ai of config.foes) {
    const b = newBoard(config, "ai", 1, ai, ai.blade, rng);
    boards.push(b.board);
    rng = b.rng;
  }
  return { config, boards, tick: 0, rng, nextId: 1, nextSlabId: 1, score: 0, moveCount: 0, lastMove: null, finished: false, outcome: null };
}

export function replaySwordfight(seed: string, moves: readonly SwordfightMove[], config: SwordfightConfig = DEFAULT_SWORDFIGHT_CONFIG): SwordfightState {
  let s = createSwordfightGame(seed, config);
  for (const m of moves) s = reduceSwordfight(s, m);
  return s;
}

// ---- board geometry

/** Pairs appear in this column, in the top two rows. */
export const spawnCol = (cfg: SwordfightConfig): number => Math.floor((cfg.width - 1) / 2);

/**
 * The top of a column: one above its highest cell, where a dropped block comes to rest. A slab
 * can hang over an empty cell (it rests on any one of its columns), so this is read from the top
 * down; the hole under an overhang is never filled from above.
 */
export function colHeight(cfg: SwordfightConfig, cells: ReadonlyArray<SwordCell | null>, col: number): number {
  let h = cfg.height;
  while (h > 0 && cells[idx(cfg, col, h - 1)] === null) h--;
  return h;
}

/** The entry is covered when the top cell of the column a pair comes in down holds something. */
export function entryBlocked(cfg: SwordfightConfig, cells: ReadonlyArray<SwordCell | null>): boolean {
  return cells[idx(cfg, spawnCol(cfg), cfg.height - 1)] !== null;
}

/** A board is out when its entry is covered, or when the pair in hand has nowhere at all to come to rest. */
export function boardOut(cfg: SwordfightConfig, board: SwordBoard): boolean {
  return entryBlocked(cfg, board.cells) || legalDrops(cfg, board).length === 0;
}

/** The columns the two halves occupy for an anchor column and rotation, a then b. */
export function pairCols(col: number, rot: SwordRotation): [number, number] {
  switch (rot) {
    case 0:
      return [col, col + 1];
    case 1:
    case 3:
      return [col, col];
    case 2:
      return [col + 1, col];
    default:
      return [col, col];
  }
}

/** Where the halves come to rest when dropped from above: cell indices for a and b, or null when there is no room. */
export function landingCells(cfg: SwordfightConfig, cells: ReadonlyArray<SwordCell | null>, col: number, rot: SwordRotation): [number, number] | null {
  const [ca, cb] = pairCols(col, rot);
  if (ca < 0 || cb < 0 || ca >= cfg.width || cb >= cfg.width) return null;
  if (rot === 1 || rot === 3) {
    const h = colHeight(cfg, cells, col);
    if (h + 2 > cfg.height) return null;
    // 1: a below b. 3: b below a.
    return rot === 1 ? [idx(cfg, col, h), idx(cfg, col, h + 1)] : [idx(cfg, col, h + 1), idx(cfg, col, h)];
  }
  const ha = colHeight(cfg, cells, ca);
  const hb = colHeight(cfg, cells, cb);
  if (ha >= cfg.height || hb >= cfg.height) return null;
  return [idx(cfg, ca, ha), idx(cfg, cb, hb)];
}

/**
 * Why a pair cannot come to rest at (col, rot) on this board, or null when it can: the halves need
 * room, and every column between the entry and the pair must have its top cell free for the pair
 * to have got there. Nothing but a slab's edge ever overhangs, and a pair never passes under one.
 */
export function dropIllegalReason(cfg: SwordfightConfig, board: SwordBoard, col: number, rot: number): string | null {
  if (board.out) return "out of the fight";
  if (!int(col, 0, cfg.width - 1) || !int(rot, 0, 3)) return "bad drop";
  const land = landingCells(cfg, board.cells, col, rot as SwordRotation);
  if (land === null) return "no room";
  const [ca, cb] = pairCols(col, rot as SwordRotation);
  const lo = Math.min(spawnCol(cfg), ca, cb);
  const hi = Math.max(spawnCol(cfg), ca, cb);
  for (let c = lo; c <= hi; c++) if (colHeight(cfg, board.cells, c) >= cfg.height) return "no way through";
  return null;
}

export function legalDrops(cfg: SwordfightConfig, board: SwordBoard): Array<{ col: number; rot: SwordRotation }> {
  const out: Array<{ col: number; rot: SwordRotation }> = [];
  for (const rot of [0, 1, 2, 3] as const) for (let col = 0; col < cfg.width; col++) if (dropIllegalReason(cfg, board, col, rot) === null) out.push({ col, rot });
  return out;
}

// ---- resolution: pure in the board, randomness only for ripening colors

/** A board being worked on: mutable copies of its cells and slabs. */
interface Work {
  cells: Cells;
  slabs: Slab[];
}

function slabCells(cfg: SwordfightConfig, s: Slab): number[] {
  const out: number[] = [];
  for (let r = s.row; r < s.row + s.h; r++) for (let c = s.col; c < s.col + s.w; c++) out.push(idx(cfg, c, r));
  return out;
}

/** Gravity. Slabs fall as one piece and may hang over a hole; everything else falls on its own. Slab origins follow their cells. */
function settle(cfg: SwordfightConfig, w: Work): void {
  const n = cfg.width * cfg.height;
  for (;;) {
    let moved = false;
    const done = new Set<number>();
    for (let i = 0; i < n; i++) {
      const c = w.cells[i];
      if (!c) continue;
      if (c.slab && done.has(c.slab)) continue;
      let unit: number[];
      if (c.slab) {
        done.add(c.slab);
        unit = [];
        for (let j = i; j < n; j++) if (w.cells[j]?.slab === c.slab) unit.push(j);
      } else unit = [i];
      let canFall = true;
      for (const u of unit) {
        if (rowOf(cfg, u) === 0 || (w.cells[u - cfg.width] !== null && !unit.includes(u - cfg.width))) {
          canFall = false;
          break;
        }
      }
      if (!canFall) continue;
      for (const u of unit) {
        w.cells[u - cfg.width] = w.cells[u]!;
        w.cells[u] = null;
      }
      moved = true;
    }
    if (!moved) break;
  }
  w.slabs = w.slabs.map((s) => {
    let row = cfg.height;
    for (let i = 0; i < n; i++) if (w.cells[i]?.slab === s.id) row = Math.min(row, rowOf(cfg, i));
    return row === s.row ? s : { ...s, row };
  });
}

/**
 * Fuse blocks into slabs: any two-by-two of loose blocks of one color becomes a slab, and a slab
 * takes in a full strip of its color along any side, loose blocks or a slab of the same span.
 * Repeats until nothing changes. Returns every slab made or grown, in the order it happened.
 */
function fuse(cfg: SwordfightConfig, w: Work, nextSlabId: number): { fused: Slab[]; nextSlabId: number } {
  const fused: Slab[] = [];
  const at = (col: number, row: number): SwordCell | null => (col < 0 || row < 0 || col >= cfg.width || row >= cfg.height ? null : w.cells[idx(cfg, col, row)]!);
  const loose = (c: SwordCell | null, color: number): boolean => c !== null && c.kind === "block" && c.slab === 0 && c.color === color;
  const claim = (s: Slab): void => {
    for (const i of slabCells(cfg, s)) w.cells[i] = { ...w.cells[i]!, slab: s.id };
  };
  for (;;) {
    let changed = false;
    for (let r = 0; r + 1 < cfg.height; r++) {
      for (let c = 0; c + 1 < cfg.width; c++) {
        const a = at(c, r);
        if (!a || a.kind !== "block" || a.slab !== 0) continue;
        if (!loose(at(c + 1, r), a.color) || !loose(at(c, r + 1), a.color) || !loose(at(c + 1, r + 1), a.color)) continue;
        const s: Slab = { id: nextSlabId++, color: a.color, col: c, row: r, w: 2, h: 2 };
        w.slabs.push(s);
        claim(s);
        fused.push(s);
        changed = true;
      }
    }
    for (let k = 0; k < w.slabs.length; k++) {
      const s = w.slabs[k]!;
      // Each side: the strip of cells just beyond it, and what would be absorbed.
      const sides: Array<{ strip: Array<SwordCell | null>; grow(t: Slab | null): Slab; matches(t: Slab): boolean }> = [
        {
          strip: Array.from({ length: s.w }, (_, i) => at(s.col + i, s.row + s.h)),
          grow: (t) => ({ ...s, h: s.h + (t ? t.h : 1) }),
          matches: (t) => t.col === s.col && t.w === s.w && t.row === s.row + s.h,
        },
        {
          strip: Array.from({ length: s.w }, (_, i) => at(s.col + i, s.row - 1)),
          grow: (t) => ({ ...s, row: s.row - (t ? t.h : 1), h: s.h + (t ? t.h : 1) }),
          matches: (t) => t.col === s.col && t.w === s.w && t.row + t.h === s.row,
        },
        {
          strip: Array.from({ length: s.h }, (_, i) => at(s.col - 1, s.row + i)),
          grow: (t) => ({ ...s, col: s.col - (t ? t.w : 1), w: s.w + (t ? t.w : 1) }),
          matches: (t) => t.row === s.row && t.h === s.h && t.col + t.w === s.col,
        },
        {
          strip: Array.from({ length: s.h }, (_, i) => at(s.col + s.w, s.row + i)),
          grow: (t) => ({ ...s, w: s.w + (t ? t.w : 1) }),
          matches: (t) => t.row === s.row && t.h === s.h && t.col === s.col + s.w,
        },
      ];
      let grown: Slab | null = null;
      for (const side of sides) {
        if (side.strip.some((c) => c === null || c.kind !== "block" || c.color !== s.color)) continue;
        if (side.strip.every((c) => c!.slab === 0)) grown = side.grow(null);
        else {
          const tid = side.strip[0]!.slab;
          if (!side.strip.every((c) => c!.slab === tid)) continue;
          const t = w.slabs.find((x) => x.id === tid);
          if (!t || !side.matches(t)) continue;
          grown = side.grow(t);
          w.slabs = w.slabs.filter((x) => x.id !== tid);
          k = w.slabs.indexOf(s);
        }
        break;
      }
      if (!grown) continue;
      w.slabs[k] = grown;
      claim(grown);
      fused.push(grown);
      changed = true;
    }
    if (!changed) return { fused, nextSlabId };
  }
}

const NEIGHBORS = (cfg: SwordfightConfig, i: number): number[] => {
  const c = colOf(cfg, i);
  const r = rowOf(cfg, i);
  const out: number[] = [];
  if (c > 0) out.push(i - 1);
  if (c < cfg.width - 1) out.push(i + 1);
  if (r > 0) out.push(i - cfg.width);
  if (r < cfg.height - 1) out.push(i + cfg.width);
  return out;
};

const breakable = (c: SwordCell | null, color: number): c is SwordCell => c !== null && c.kind !== "wrack" && c.color === color;

interface BreakGroup {
  color: number;
  cells: number[];
  ids: number[];
  points: number;
}

/** Every breaker resting against its color, with everything of that color connected to it. */
function findBreaks(cfg: SwordfightConfig, w: Work): BreakGroup[] {
  const groups: BreakGroup[] = [];
  const taken = new Uint8Array(w.cells.length);
  for (let i = 0; i < w.cells.length; i++) {
    const c = w.cells[i];
    if (!c || c.kind !== "breaker" || taken[i]) continue;
    if (!NEIGHBORS(cfg, i).some((n) => breakable(w.cells[n]!, c.color))) continue;
    const cells: number[] = [];
    const stack = [i];
    taken[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      cells.push(cur);
      for (const n of NEIGHBORS(cfg, cur)) {
        if (taken[n] || !breakable(w.cells[n]!, c.color)) continue;
        taken[n] = 1;
        stack.push(n);
      }
    }
    cells.sort((a, b) => a - b);
    // Slabs score as one block each: the bigger, the better.
    const perSlab = new Map<number, number>();
    let points = 0;
    for (const x of cells) {
      const s = w.cells[x]!.slab;
      if (s) perSlab.set(s, (perSlab.get(s) ?? 0) + 1);
      else points += cfg.cellPoints;
    }
    for (const n of perSlab.values()) points += cfg.cellPoints * n + (cfg.slabBonus * n * (n - 1)) / 2;
    groups.push({ color: c.color, cells, ids: cells.map((x) => w.cells[x]!.id), points: Math.floor(points) });
  }
  return groups;
}

/** Fuse, break, settle, until nothing breaks. `chain` is the chain so far this drop. */
function resolve(cfg: SwordfightConfig, w: Work, board: number, tick: number, chain: number, events: SwordfightEvent[], nextSlabId: number): { points: number; chain: number; nextSlabId: number } {
  let points = 0;
  for (;;) {
    const f = fuse(cfg, w, nextSlabId);
    nextSlabId = f.nextSlabId;
    if (f.fused.length) events.push({ tick, board, type: "fused", slabs: f.fused });
    const groups = findBreaks(cfg, w);
    if (groups.length === 0) return { points, chain, nextSlabId };
    chain += 1;
    const step = groups.reduce((sum, g) => sum + g.points, 0) * groups.length * chain;
    events.push({ tick, board, type: "broke", chain, groups, points: step });
    const gone = new Set<number>();
    for (const g of groups) for (const c of g.cells) gone.add(c);
    const slabsGone = new Set<number>();
    for (const c of gone) {
      const s = w.cells[c]!.slab;
      if (s) slabsGone.add(s);
      w.cells[c] = null;
    }
    w.slabs = w.slabs.filter((s) => !slabsGone.has(s.id));
    settle(cfg, w);
    events.push({ tick, board, type: "settled", cells: w.cells.slice(), slabs: w.slabs.slice() });
    points += step;
  }
}

/** Wrack that has been on the board long enough turns into blocks of a random color each. */
function ripen(cfg: SwordfightConfig, w: Work, board: number, tick: number, rng: PrngState, events: SwordfightEvent[]): PrngState {
  const ids: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < w.cells.length; i++) {
    const c = w.cells[i];
    if (!c || c.kind !== "wrack") continue;
    const left = c.ripen - 1;
    if (left > 0) {
      w.cells[i] = { ...c, ripen: left };
      continue;
    }
    const r = nextInt(rng, cfg.colors);
    rng = r.state;
    w.cells[i] = { ...c, kind: "block", color: r.value, ripen: 0 };
    ids.push(c.id);
    colors.push(r.value);
  }
  if (ids.length) events.push({ tick, board, type: "ripened", ids, colors });
  return rng;
}

export interface DropResult {
  readonly cells: ReadonlyArray<SwordCell | null>;
  readonly slabs: readonly Slab[];
  readonly points: number;
  readonly chain: number;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly nextSlabId: number;
  readonly events: readonly SwordfightEvent[];
}

/**
 * Drop the board's current pair at (col, rot) and play it out: fuse, break, settle, ripen, and
 * once more for what ripening set off. Pure in its inputs; the AI evaluates drops with it too.
 */
export function applyDrop(cfg: SwordfightConfig, board: SwordBoard, boardIndex: number, col: number, rot: SwordRotation, tick: number, rng: PrngState, nextId: number, nextSlabId: number): DropResult {
  const land = landingCells(cfg, board.cells, col, rot);
  if (!land) throw new Error("no room for the drop");
  const w: Work = { cells: board.cells.slice(), slabs: board.slabs.slice() };
  const events: SwordfightEvent[] = [];
  const mk = (p: SwordPiece): SwordCell => ({ id: nextId++, color: p.color, kind: p.breaker ? "breaker" : "block", ripen: 0, slab: 0 });
  const ca = mk(board.current.a);
  const cb = mk(board.current.b);
  w.cells[land[0]] = ca;
  w.cells[land[1]] = cb;
  events.push({ tick, board: boardIndex, type: "placed", cells: land, ids: [ca.id, cb.id] });
  const r1 = resolve(cfg, w, boardIndex, tick, 0, events, nextSlabId);
  nextSlabId = r1.nextSlabId;
  const before = events.length;
  rng = ripen(cfg, w, boardIndex, tick, rng, events);
  let points = r1.points;
  let chain = r1.chain;
  if (events.length > before) {
    const r2 = resolve(cfg, w, boardIndex, tick, chain, events, nextSlabId);
    nextSlabId = r2.nextSlabId;
    points += r2.points;
    chain = r2.chain;
  }
  return { cells: w.cells, slabs: w.slabs, points, chain, rng, nextId, nextSlabId, events };
}

/** Land waiting wrack on a board, up to the cap, in the blades' columns. */
function landWrack(cfg: SwordfightConfig, board: SwordBoard, boardIndex: number, tick: number, nextId: number, events: SwordfightEvent[]): { board: SwordBoard; nextId: number } {
  if (board.pending.length === 0) return { board, nextId };
  const cells: Cells = board.cells.slice();
  let cursor = board.cursor;
  let budget = cfg.incomingCapRows * cfg.width;
  const pending: PendingAttack[] = [];
  const landedCells: number[] = [];
  const ids: number[] = [];
  let full = false;
  let bladeShown = board.pending[0]!.blade;
  for (const p of board.pending) {
    let left = p.wrack;
    const blade = cfg.blades[p.blade] ?? cfg.blades[0]!;
    while (left > 0 && budget > 0 && !full) {
      let placed = false;
      for (let tries = 0; tries < blade.columns.length; tries++) {
        const col = blade.columns[cursor % blade.columns.length]!;
        cursor++;
        const h = colHeight(cfg, cells, col);
        if (h >= cfg.height) continue;
        const i = idx(cfg, col, h);
        const cell: SwordCell = { id: nextId++, color: -1, kind: "wrack", ripen: cfg.ripenMoves, slab: 0 };
        cells[i] = cell;
        landedCells.push(i);
        ids.push(cell.id);
        placed = true;
        break;
      }
      if (!placed) {
        full = true;
        break;
      }
      left--;
      budget--;
    }
    if (left > 0) pending.push({ wrack: left, blade: p.blade });
    bladeShown = p.blade;
  }
  if (landedCells.length) events.push({ tick, board: boardIndex, type: "landed", cells: landedCells, ids, blade: bladeShown });
  return { board: { ...board, cells, cursor, pending: full ? [] : pending, pendingSince: pending.length && !full ? tick : -1 }, nextId };
}

// ---- the fight

interface Sim {
  boards: SwordBoard[];
  rng: PrngState;
  nextId: number;
  nextSlabId: number;
  events: SwordfightEvent[];
  finished: boolean;
  outcome: SwordfightOutcome | null;
}

const load = (b: SwordBoard): number => b.cells.reduce((n, c) => n + (c ? 1 : 0), 0) + b.pending.reduce((n, p) => n + p.wrack, 0);

/** Whether the side facing `side` is outside this fight: attacks leave it and arrive as incoming moves. */
export function opposingSideExternal(cfg: SwordfightConfig, side: 0 | 1): boolean {
  return side === 0 ? cfg.foes.length === 0 : !cfg.player && cfg.allies.length === 0;
}

/** The opposing board with the least on it, or -1. */
function chooseTarget(boards: readonly SwordBoard[], from: number): number {
  let best = -1;
  let bestLoad = Infinity;
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i]!;
    if (b.side === boards[from]!.side || b.out) continue;
    const l = load(b);
    if (l < bestLoad) {
      best = i;
      bestLoad = l;
    }
  }
  return best;
}

function markOut(sim: Sim, i: number, tick: number): void {
  const b = sim.boards[i]!;
  if (b.out) return;
  sim.boards[i] = { ...b, out: true, pending: [], pendingSince: -1 };
  sim.events.push({ tick, board: i, type: "out" });
}

function checkEnd(cfg: SwordfightConfig, sim: Sim, tick: number): void {
  if (sim.finished) return;
  const side0 = sim.boards.filter((b) => b.side === 0);
  const side1 = sim.boards.filter((b) => b.side === 1);
  let outcome: SwordfightOutcome | null = null;
  if (side0.length && side0.every((b) => b.out)) outcome = "lost";
  else if (side1.length && side1.every((b) => b.out)) outcome = "won";
  if (outcome === null) return;
  sim.finished = true;
  sim.outcome = outcome;
  sim.events.push({ tick, board: cfg.player ? 0 : -1, type: "ended", outcome });
}

/** A board drops its pair: play it out, send what it earned, take what was waiting, deal the next pair. */
function dropOn(cfg: SwordfightConfig, sim: Sim, i: number, col: number, rot: SwordRotation, tick: number): void {
  const before = sim.boards[i]!;
  const r = applyDrop(cfg, before, i, col, rot, tick, sim.rng, sim.nextId, sim.nextSlabId);
  sim.rng = r.rng;
  sim.nextId = r.nextId;
  sim.nextSlabId = r.nextSlabId;
  sim.events.push(...r.events);
  let board: SwordBoard = { ...before, cells: r.cells, slabs: r.slabs, points: before.points + r.points, drops: before.drops + 1, bestChain: Math.max(before.bestChain, r.chain) };
  // Attack: points become wrack, which first cancels wrack waiting here, then goes over.
  let pool = board.pool + r.points;
  let wrack = Math.floor(pool / cfg.attackPoints);
  pool -= wrack * cfg.attackPoints;
  let offset = 0;
  let pending = board.pending.slice();
  if (wrack > 0 && cfg.offset) {
    while (wrack > 0 && pending.length) {
      const p = pending[0]!;
      const take = Math.min(wrack, p.wrack);
      wrack -= take;
      offset += take;
      if (take === p.wrack) pending.shift();
      else pending[0] = { ...p, wrack: p.wrack - take };
    }
  }
  board = { ...board, pool, pending, pendingSince: pending.length ? board.pendingSince : -1 };
  if (wrack > 0 || offset > 0) {
    const to = wrack > 0 ? chooseTarget(sim.boards, i) : -2;
    if (to >= 0) {
      const t = sim.boards[to]!;
      sim.boards[to] = { ...t, pending: [...t.pending, { wrack, blade: board.blade }], pendingSince: t.pending.length ? t.pendingSince : tick };
      sim.events.push({ tick, board: i, type: "attack", to, wrack, offset, blade: board.blade });
    } else if (wrack > 0 && opposingSideExternal(cfg, board.side)) sim.events.push({ tick, board: i, type: "attack", to: -1, wrack, offset, blade: board.blade });
    else sim.events.push({ tick, board: i, type: "attack", to: -2, wrack: 0, offset, blade: board.blade });
    board = { ...board, sent: board.sent + wrack };
  }
  // What was still waiting lands now.
  const landed = landWrack(cfg, board, i, tick, sim.nextId, sim.events);
  board = landed.board;
  sim.nextId = landed.nextId;
  // The next pair.
  const dealt = dealPair(cfg, sim.rng);
  sim.rng = dealt.rng;
  board = { ...board, current: board.next, next: dealt.pair, spawnedAt: tick };
  sim.boards[i] = board;
  if (boardOut(cfg, board)) markOut(sim, i, tick);
  checkEnd(cfg, sim, tick);
}

function landOn(cfg: SwordfightConfig, sim: Sim, i: number, tick: number): void {
  const landed = landWrack(cfg, sim.boards[i]!, i, tick, sim.nextId, sim.events);
  sim.boards[i] = landed.board;
  sim.nextId = landed.nextId;
  if (boardOut(cfg, landed.board)) markOut(sim, i, tick);
  checkEnd(cfg, sim, tick);
}

function aiActs(cfg: SwordfightConfig, sim: Sim, i: number, tick: number): void {
  const b = sim.boards[i]!;
  const next = { ...b, nextActTick: tick + b.ai!.thinkTicks };
  sim.boards[i] = next;
  const pick = chooseAiDrop(cfg, next, sim.rng);
  sim.rng = pick.rng;
  if (pick.drop === null) {
    markOut(sim, i, tick);
    checkEnd(cfg, sim, tick);
    return;
  }
  dropOn(cfg, sim, i, pick.drop.col, pick.drop.rot, tick);
}

/** Everything due up to `tick`, in order: landings before drops at the same tick, lower boards first. */
function simulate(state: SwordfightState, tick: number): Sim {
  const cfg = state.config;
  const sim: Sim = { boards: state.boards.slice(), rng: state.rng, nextId: state.nextId, nextSlabId: state.nextSlabId, events: [], finished: state.finished, outcome: state.outcome };
  for (;;) {
    if (sim.finished) break;
    let at = Infinity;
    let kind = 0;
    let who = -1;
    for (let i = 0; i < sim.boards.length; i++) {
      const b = sim.boards[i]!;
      if (b.out) continue;
      if (b.pending.length && b.pendingSince >= 0) {
        const t = b.pendingSince + cfg.landAfterTicks;
        if (t <= tick && (t < at || (t === at && kind > 0))) {
          at = t;
          kind = 0;
          who = i;
        }
      }
      if (b.ai && b.nextActTick <= tick && (b.nextActTick < at || (b.nextActTick === at && kind === 1 && who < 0))) {
        at = b.nextActTick;
        kind = 1;
        who = i;
      }
    }
    if (who < 0) break;
    if (kind === 0) landOn(cfg, sim, who, Math.max(at, state.tick));
    else aiActs(cfg, sim, who, Math.max(at, state.tick));
  }
  return sim;
}

function finish(state: SwordfightState, sim: Sim, move: SwordfightMove, tick: number): SwordfightState {
  const cfg = state.config;
  const player = cfg.player ? sim.boards[0]! : null;
  const earned = player ? player.points - state.boards[0]!.points : 0;
  let score = state.score + earned;
  if (sim.finished && !state.finished && sim.outcome === "won") score += cfg.winPoints;
  const report: SwordfightMoveReport = { move, events: sim.events, points: earned };
  return {
    config: cfg,
    boards: sim.boards,
    tick,
    rng: sim.rng,
    nextId: sim.nextId,
    nextSlabId: sim.nextSlabId,
    score,
    moveCount: state.moveCount + 1,
    lastMove: report,
    finished: sim.finished,
    outcome: sim.outcome,
  };
}

/** Why the player's pair cannot come to rest at (col, rot) at `tick` right now, or null. */
export function placeIllegalReason(state: SwordfightState, col: number, rot: number, tick: number): string | null {
  if (state.finished) return "finished";
  if (!state.config.player) return "no player in this fight";
  if (!int(tick, state.tick, state.config.maxTick)) return "bad tick";
  const board = state.boards[0]!;
  if (tick < board.spawnedAt + state.config.dropTicks) return "too soon";
  return dropIllegalReason(state.config, board, col, rot);
}

export function reduceSwordfight(state: SwordfightState, move: SwordfightMove): SwordfightState {
  if (state.finished) throw new InvalidMoveError("finished", move);
  const cfg = state.config;
  if (!int(move.tick, state.tick, cfg.maxTick)) throw new InvalidMoveError("bad tick", move);
  switch (move.type) {
    case "wait": {
      const sim = simulate(state, move.tick);
      return finish(state, sim, move, move.tick);
    }
    case "place": {
      const why = placeIllegalReason(state, move.col, move.rot, move.tick);
      if (why) throw new InvalidMoveError(why, move);
      const sim = simulate(state, move.tick);
      // Time may have ended the fight or filled the entry before the pair came down.
      if (!sim.finished && !sim.boards[0]!.out) {
        const again = dropIllegalReason(cfg, sim.boards[0]!, move.col, move.rot);
        if (again) throw new InvalidMoveError(again, move);
        dropOn(cfg, sim, 0, move.col, move.rot, move.tick);
      }
      return finish(state, sim, move, move.tick);
    }
    case "incoming": {
      if (!int(move.board, 0, state.boards.length - 1) || !int(move.wrack, 1, 999) || !int(move.blade, 0, cfg.blades.length - 1)) throw new InvalidMoveError("bad incoming", move);
      const target = state.boards[move.board]!;
      if (!opposingSideExternal(cfg, target.side)) throw new InvalidMoveError("this fight has its own foes", move);
      const sim = simulate(state, move.tick);
      const t = sim.boards[move.board]!;
      if (!sim.finished && !t.out) {
        sim.boards[move.board] = { ...t, pending: [...t.pending, { wrack: move.wrack, blade: move.blade }], pendingSince: t.pending.length ? t.pendingSince : move.tick };
        sim.events.push({ tick: move.tick, board: move.board, type: "incoming", wrack: move.wrack, blade: move.blade });
      }
      return finish(state, sim, move, move.tick);
    }
    case "end": {
      if (move.won !== undefined && typeof move.won !== "boolean") throw new InvalidMoveError("bad end", move);
      const won = move.won === true;
      if (won && !opposingSideExternal(cfg, 0)) throw new InvalidMoveError("the foes are in this fight; beat them", move);
      const sim = simulate(state, move.tick);
      if (!sim.finished) {
        sim.finished = true;
        sim.outcome = won ? "won" : "lost";
        sim.events.push({ tick: move.tick, board: cfg.player ? 0 : -1, type: "ended", outcome: sim.outcome });
      }
      return finish(state, sim, move, move.tick);
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError("unknown move", never);
    }
  }
}

/** The state at a later tick without logging a move: what the board shows between moves. */
export function advanceSwordfight(state: SwordfightState, tick: number): SwordfightState {
  if (tick <= state.tick || state.finished) return state;
  const t = Math.min(tick, state.config.maxTick);
  const sim = simulate(state, t);
  const next = finish(state, sim, { type: "wait", tick: t }, t);
  return { ...next, moveCount: state.moveCount };
}

// ---- hashing and summary

const KINDS = ["block", "breaker", "wrack"] as const;
const OUTCOMES: readonly SwordfightOutcome[] = ["won", "lost"];

export function hashSwordfightState(s: SwordfightState): string {
  const h = new Hasher();
  h.int(s.tick).int(s.nextId).int(s.nextSlabId).int(s.score).int(s.moveCount).int(s.finished ? 1 : 0).int(s.outcome === null ? -1 : OUTCOMES.indexOf(s.outcome));
  h.int(s.rng.a).int(s.rng.b).int(s.rng.c).int(s.rng.d);
  h.int(s.boards.length);
  for (const b of s.boards) {
    h.int(b.side).int(b.blade).int(b.spawnedAt).int(b.pendingSince).int(b.cursor).int(b.drops).int(b.points).int(b.pool).int(b.sent).int(b.bestChain).int(b.out ? 1 : 0).int(b.nextActTick);
    for (const c of b.cells) {
      if (c === null) h.int(-1);
      else h.int(c.id).int(c.color).int(KINDS.indexOf(c.kind)).int(c.ripen).int(c.slab);
    }
    h.int(b.slabs.length);
    for (const sl of b.slabs) h.int(sl.id).int(sl.color).int(sl.col).int(sl.row).int(sl.w).int(sl.h);
    for (const p of [b.current.a, b.current.b, b.next.a, b.next.b]) h.int(p.color).int(p.breaker ? 1 : 0);
    h.int(b.pending.length);
    for (const p of b.pending) h.int(p.wrack).int(p.blade);
  }
  return h.digest();
}

export interface SwordfightSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeSwordfight(s: SwordfightState): SwordfightSummary {
  const player = s.config.player ? s.boards[0]! : null;
  return { score: s.score, moves: player ? player.drops : s.moveCount, bestCombo: player ? player.bestChain : 0 };
}

/** A board as a string, top row first: `.` empty, 0-5 a color, A-F a breaker, `#` wrack. Melee snapshots and the smoke test read it. */
export function boardString(cfg: SwordfightConfig, cells: ReadonlyArray<SwordCell | null>): string {
  let out = "";
  for (let r = cfg.height - 1; r >= 0; r--) {
    for (let c = 0; c < cfg.width; c++) {
      const cell = cells[idx(cfg, c, r)];
      out += !cell ? "." : cell.kind === "wrack" ? "#" : cell.kind === "breaker" ? String.fromCharCode(65 + cell.color) : String(cell.color);
    }
  }
  return out;
}

/** What is on a board: filled cells plus wrack waiting to land. The server sends attacks to the opposing board with the least. */
export function boardLoad(b: SwordBoard): number {
  return load(b);
}

/** The boards on a side that are still standing. */
export function standing(state: SwordfightState, side: 0 | 1): number {
  return state.boards.filter((b) => b.side === side && !b.out).length;
}
