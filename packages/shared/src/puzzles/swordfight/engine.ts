/**
 * Swordfight — Puyo-style versus puzzle with breakers.
 *
 * The engine models ONE combatant's board. Attacks are never applied to another
 * board here: clears append to `state.outgoing`, which the server drains and turns
 * into `{ type: 'garbage' }` actions for an opponent (see `garbagePatternFor`).
 *
 * Grid is `grid[y][x]`, y = 0 is the hidden spawn row at the top, y = ROWS-1 is
 * the floor. A falling piece is a pair: pivot block `a` plus satellite `b` placed
 * at `satOffset(dir)` from the pivot.
 */
import type { Rng } from '../../rng';
import { rngFromSeed, rngInt, rngNext, rngShuffle } from '../../rng';
import { clamp01, ema, ratingLabel, type BasePuzzleState, type PuzzleConfig, type PuzzleDef, type PuzzleScore } from '../types';

export const COLS = 6;
export const ROWS = 13;
/** Rows at the top that are hidden from the player (spawn area). */
export const HIDDEN_ROWS = 1;
export const NUM_COLORS = 4;
/** Cell/pattern value for grey junk. */
export const JUNK = -1;
/** Pattern value for an empty cell in a garbage row. */
export const GAP = -2;
export const BREAKER_CHANCE = 0.22;
export const LOCK_MS = 250;
export const MIN_FALL_MS = 300;
export const PERF_WINDOW_MS = 10000;
export const SPAWN_X = 2;
export const SPAWN_Y = 1;
export const DEFAULT_DURATION_MS = 180000;

export interface Block {
  /** 0..3 colour, or JUNK (-1) for grey junk. */
  color: number;
  breaker: boolean;
}
export type Cell = Block | null;
/** Satellite direction relative to pivot: 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;

export interface Pair {
  /** Pivot block. */
  a: Block;
  /** Satellite block. */
  b: Block;
  x: number;
  y: number;
  dir: Dir;
}

export interface ClearedCell {
  x: number;
  y: number;
  color: number;
  breaker: boolean;
  /** 1-based chain pass in which the cell was cleared. */
  pass: number;
}

export interface Attack {
  power: number;
  seq: number;
}

export interface State extends BasePuzzleState {
  cols: number;
  rows: number;
  grid: Cell[][];
  /** Falling pair, null once KO'd. */
  cur: Pair | null;
  /** Next pair (preview). */
  next: Pair;
  fallMs: number;
  fallAcc: number;
  lockAcc: number;
  difficulty: number;
  durationMs: number;
  ko: boolean;
  /** Number of pairs locked so far. */
  pieces: number;
  /** Increments on every lock (renderer: play lock sound, snap animation). */
  lockSeq: number;
  /** Cells cleared by the last lock that cleared anything (positions pre-gravity, per pass). */
  lastClears: ClearedCell[];
  /** Chain length of the last lock (0 when nothing cleared). */
  chain: number;
  /** Increments whenever a lock clears something. */
  clearSeq: number;
  /** Attacks produced but not yet drained by the server. */
  outgoing: Attack[];
  attackSeq: number;
  damageDealt: number;
  damageTaken: number;
  blocksCleared: number;
  /** Incoming threat for display only; the server sets it via `warn`. */
  pendingGarbage: number;
  /** Increments whenever garbage lands (renderer: red flash, hit sound). */
  garbageSeq: number;
  lastGarbageRows: number;
  perf: number;
  windowMs: number;
  windowPower: number;
}

export type Action =
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'rotateCW' }
  | { type: 'rotateCCW' }
  | { type: 'softDrop' }
  | { type: 'hardDrop' }
  /** Server-only: rows (bottom-most first) of JUNK / 0..3 colour / GAP values. */
  | { type: 'garbage'; pattern: number[][] }
  /** Server-only: updates the displayed incoming-threat number. */
  | { type: 'warn'; power: number };

// ---------------------------------------------------------------------------
// Geometry helpers

const OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function satOffset(dir: Dir): readonly [number, number] {
  return OFFSETS[dir]!;
}

export interface PairCell {
  x: number;
  y: number;
  block: Block;
}

export function pairCells(p: Pair): [PairCell, PairCell] {
  const [dx, dy] = satOffset(p.dir);
  return [
    { x: p.x, y: p.y, block: p.a },
    { x: p.x + dx, y: p.y + dy, block: p.b },
  ];
}

function cellFree(grid: Cell[][], x: number, y: number): boolean {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  return grid[y]![x] === null;
}

export function pairFits(grid: Cell[][], p: Pair): boolean {
  const [c0, c1] = pairCells(p);
  return cellFree(grid, c0.x, c0.y) && cellFree(grid, c1.x, c1.y);
}

function tryMove(grid: Cell[][], p: Pair, dx: number, dy: number): Pair | null {
  const np: Pair = { ...p, x: p.x + dx, y: p.y + dy };
  return pairFits(grid, np) ? np : null;
}

function tryRotate(grid: Cell[][], p: Pair, delta: 1 | -1): Pair | null {
  const dir = (((p.dir + delta) % 4) + 4) % 4 as Dir;
  const [ox, oy] = satOffset(dir);
  // Kicks: in place, away from the wall the satellite points at, then a floor kick.
  const kicks: (readonly [number, number])[] = [[0, 0], [-ox, 0], [0, -1]];
  if (oy === 0) kicks.push([-ox * 2, 0]);
  for (const [kx, ky] of kicks) {
    const np: Pair = { ...p, dir, x: p.x + kx, y: p.y + ky };
    if (np.y < 0) continue;
    if (pairFits(grid, np)) return np;
  }
  return null;
}

function canFall(grid: Cell[][], p: Pair): boolean {
  return tryMove(grid, p, 0, 1) !== null;
}

/** Drops the pair as a unit until it rests. */
export function hardDropPair(grid: Cell[][], p: Pair): Pair {
  let cur = p;
  for (;;) {
    const n = tryMove(grid, cur, 0, 1);
    if (!n) return cur;
    cur = n;
  }
}

/** Lowest empty y in a column (ROWS-1 for an empty column, -1 when full). */
function restY(grid: Cell[][], x: number): number {
  for (let y = ROWS - 1; y >= 0; y--) if (grid[y]![x] === null) return y;
  return -1;
}

/**
 * Where each block of the pair ends up after the drop and the split-fall, in the
 * order [pivot, satellite]. Used for the ghost piece and the AI.
 */
export function landingCells(grid: Cell[][], p: Pair): [PairCell, PairCell] {
  const dropped = hardDropPair(grid, p);
  const [c0, c1] = pairCells(dropped);
  if (c0.x === c1.x) {
    const r = restY(grid, c0.x);
    const lower = c0.y > c1.y ? c0 : c1;
    const upper = lower === c0 ? c1 : c0;
    const lo = { ...lower, y: r };
    const up = { ...upper, y: r - 1 };
    return lower === c0 ? [lo, up] : [up, lo];
  }
  return [
    { ...c0, y: restY(grid, c0.x) },
    { ...c1, y: restY(grid, c1.x) },
  ];
}

// ---------------------------------------------------------------------------
// Grid operations (all return new arrays; inputs are never mutated)

function emptyGrid(): Cell[][] {
  const g: Cell[][] = [];
  for (let y = 0; y < ROWS; y++) g.push(new Array<Cell>(COLS).fill(null));
  return g;
}

function cloneGrid(grid: Cell[][]): Cell[][] {
  return grid.map((row) => row.slice());
}

/** Column compaction. Returns [grid, moved]. The input grid is not mutated. */
export function applyGravity(grid: Cell[][]): [Cell[][], boolean] {
  const out = emptyGrid();
  let moved = false;
  for (let x = 0; x < COLS; x++) {
    let w = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      const c = grid[y]![x];
      if (c) {
        out[w]![x] = c;
        if (w !== y) moved = true;
        w--;
      }
    }
  }
  return [moved ? out : grid, moved];
}

/**
 * Finds every cell a breaker will clear this pass: each breaker that touches a
 * same-colour block (normal or breaker) clears itself and the whole 4-connected
 * same-colour group(s) it touches. Junk adjacent to any cleared coloured block
 * is cleared too. Returns a boolean mask indexed y*COLS+x and the count.
 */
export function findClears(grid: Cell[][]): [boolean[], number] {
  const mark = new Array<boolean>(ROWS * COLS).fill(false);
  let count = 0;
  const stack: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y]![x];
      if (!c || !c.breaker || c.color < 0) continue;
      let touched = false;
      for (const [dx, dy] of OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const n = grid[ny]![nx];
        if (!n || n.color !== c.color) continue;
        touched = true;
        // Flood fill the same-colour group.
        stack.push(ny * COLS + nx);
        while (stack.length) {
          const i = stack.pop()!;
          if (mark[i]) continue;
          mark[i] = true;
          count++;
          const ix = i % COLS;
          const iy = (i - ix) / COLS;
          for (const [ex, ey] of OFFSETS) {
            const fx = ix + ex;
            const fy = iy + ey;
            if (fx < 0 || fx >= COLS || fy < 0 || fy >= ROWS) continue;
            const f = grid[fy]![fx];
            if (f && f.color === c.color && !mark[fy * COLS + fx]) stack.push(fy * COLS + fx);
          }
        }
      }
      if (touched && !mark[y * COLS + x]) {
        mark[y * COLS + x] = true;
        count++;
      }
    }
  }
  if (count === 0) return [mark, 0];
  // Junk adjacent to a cleared coloured block.
  const junk: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y]![x];
      if (!c || c.color !== JUNK) continue;
      for (const [dx, dy] of OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (mark[ny * COLS + nx] && grid[ny]![nx]!.color !== JUNK) {
          junk.push(y * COLS + x);
          break;
        }
      }
    }
  }
  for (const i of junk) {
    mark[i] = true;
    count++;
  }
  return [mark, count];
}

export interface Resolution {
  grid: Cell[][];
  clears: ClearedCell[];
  /** Cleared count per pass (index 0 = chain 1). */
  passes: number[];
}

/** Repeatedly clears breaker groups and applies gravity until stable. */
export function resolveGrid(start: Cell[][]): Resolution {
  let grid = start;
  const clears: ClearedCell[] = [];
  const passes: number[] = [];
  for (let pass = 1; pass <= ROWS * COLS; pass++) {
    const [mark, count] = findClears(grid);
    if (count === 0) break;
    const next = cloneGrid(grid);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!mark[y * COLS + x]) continue;
        const c = grid[y]![x]!;
        clears.push({ x, y, color: c.color, breaker: c.breaker, pass });
        next[y]![x] = null;
      }
    }
    passes.push(count);
    grid = applyGravity(next)[0];
  }
  return { grid, clears, passes };
}

/** Attack power for a resolution: sum over passes of max(0, cleared - 3) * chainIndex. */
export function attackPowerFor(passes: readonly number[]): number {
  let p = 0;
  for (let i = 0; i < passes.length; i++) p += Math.max(0, passes[i]! - 3) * (i + 1);
  return p;
}

// ---------------------------------------------------------------------------
// Piece generation

function genBlock(rng: Rng): [Rng, Block] {
  let r = rng;
  let color: number;
  let v: number;
  [r, color] = rngInt(r, NUM_COLORS);
  [r, v] = rngNext(r);
  return [r, { color, breaker: v < BREAKER_CHANCE }];
}

function genPair(rng: Rng): [Rng, Pair] {
  let r = rng;
  let a: Block;
  let b: Block;
  [r, a] = genBlock(r);
  [r, b] = genBlock(r);
  return [r, { a, b, x: SPAWN_X, y: SPAWN_Y, dir: 0 }];
}

function fallMsFor(difficulty: number, elapsedMs: number): number {
  const base = Math.round(850 - 500 * difficulty);
  const faster = Math.floor(elapsedMs / 10000) * 20;
  return Math.max(MIN_FALL_MS, base - faster);
}

// ---------------------------------------------------------------------------
// Core transitions

function spawn(s: State): State {
  const pair: Pair = { ...s.next, x: SPAWN_X, y: SPAWN_Y, dir: 0 };
  if (!pairFits(s.grid, pair)) {
    return { ...s, cur: null, ko: true, over: true };
  }
  const [rng, next] = genPair(s.rng);
  return { ...s, rng, cur: pair, next, fallAcc: 0, lockAcc: 0, fallMs: fallMsFor(s.difficulty, s.elapsedMs) };
}

/** Places the pair (already at its resting position), resolves clears, spawns the next pair. */
function lockPair(s: State, pair: Pair): State {
  const placed = cloneGrid(s.grid);
  for (const c of pairCells(pair)) {
    if (c.y >= 0 && c.y < ROWS && c.x >= 0 && c.x < COLS) placed[c.y]![c.x] = c.block;
  }
  const settled = applyGravity(placed)[0];
  const res = resolveGrid(settled);
  const cleared = res.clears.length;
  const power = attackPowerFor(res.passes);
  let st: State = {
    ...s,
    grid: res.grid,
    cur: null,
    pieces: s.pieces + 1,
    lockSeq: s.lockSeq + 1,
    chain: res.passes.length,
    lastClears: cleared ? res.clears : s.lastClears,
    clearSeq: cleared ? s.clearSeq + 1 : s.clearSeq,
    blocksCleared: s.blocksCleared + cleared,
  };
  if (power > 0) {
    const seq = s.attackSeq + 1;
    st = {
      ...st,
      attackSeq: seq,
      outgoing: [...s.outgoing, { power, seq }],
      damageDealt: s.damageDealt + power,
      windowPower: s.windowPower + power,
      perf: ema(s.perf, clamp01(power / 5), 0.3),
    };
  }
  return spawn(st);
}

function toBlock(v: unknown): Cell {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n === JUNK) return { color: JUNK, breaker: false };
  if (n >= 0 && n < NUM_COLORS) return { color: n, breaker: false };
  return null;
}

function insertGarbage(s: State, pattern: unknown): State {
  if (!Array.isArray(pattern)) return s;
  const rows = pattern.filter((r): r is unknown[] => Array.isArray(r)).slice(0, ROWS);
  const n = rows.length;
  if (n === 0) return s;
  let ko = false;
  // Blocks pushed off the top are lost; that is a top-out.
  for (let y = 0; y < n; y++) for (let x = 0; x < COLS; x++) if (s.grid[y]![x]) ko = true;
  const shifted = emptyGrid();
  for (let y = 0; y + n < ROWS; y++) shifted[y] = s.grid[y + n]!.slice();
  let added = 0;
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    const y = ROWS - 1 - i;
    for (let x = 0; x < COLS; x++) {
      const b = toBlock(row[x]);
      shifted[y]![x] = b;
      if (b) added++;
    }
  }
  const grid = applyGravity(shifted)[0];
  for (let x = 0; x < COLS; x++) if (grid[0]![x]) ko = true;
  let cur = s.cur;
  if (cur && !ko) {
    let p: Pair = { ...cur, y: cur.y - n };
    const top = Math.min(p.y, p.y + satOffset(p.dir)[1]);
    if (top < 0) p = { ...p, y: p.y - top };
    if (!pairFits(grid, p)) ko = true;
    else cur = p;
  }
  const st: State = {
    ...s,
    grid,
    cur,
    garbageSeq: s.garbageSeq + 1,
    lastGarbageRows: n,
    damageTaken: s.damageTaken + added,
    pendingGarbage: 0,
  };
  if (ko) return { ...st, ko: true, over: true };
  return st;
}

// ---------------------------------------------------------------------------
// PuzzleDef

export function init(seed: number, config?: PuzzleConfig): State {
  const difficulty = clamp01(config?.difficulty ?? 0.4);
  const durationMs = Math.max(1000, Math.floor(config?.durationMs ?? DEFAULT_DURATION_MS));
  let rng = rngFromSeed(seed);
  let first: Pair;
  let next: Pair;
  [rng, first] = genPair(rng);
  [rng, next] = genPair(rng);
  return {
    rng,
    elapsedMs: 0,
    over: false,
    cols: COLS,
    rows: ROWS,
    grid: emptyGrid(),
    cur: first,
    next,
    fallMs: fallMsFor(difficulty, 0),
    fallAcc: 0,
    lockAcc: 0,
    difficulty,
    durationMs,
    ko: false,
    pieces: 0,
    lockSeq: 0,
    lastClears: [],
    chain: 0,
    clearSeq: 0,
    outgoing: [],
    attackSeq: 0,
    damageDealt: 0,
    damageTaken: 0,
    blocksCleared: 0,
    pendingGarbage: 0,
    garbageSeq: 0,
    lastGarbageRows: 0,
    perf: 0,
    windowMs: 0,
    windowPower: 0,
  };
}

export function reduce(s: State, a: Action): State {
  if (!a || typeof a !== 'object') return s;
  switch (a.type) {
    case 'warn': {
      const power = Math.max(0, Math.floor(Number.isFinite(a.power) ? a.power : 0));
      return power === s.pendingGarbage ? s : { ...s, pendingGarbage: power };
    }
    case 'garbage':
      return s.over ? s : insertGarbage(s, a.pattern);
    default:
      break;
  }
  if (s.over || !s.cur) return s;
  const cur = s.cur;
  switch (a.type) {
    case 'left':
    case 'right': {
      const p = tryMove(s.grid, cur, a.type === 'left' ? -1 : 1, 0);
      return p ? { ...s, cur: p, lockAcc: 0 } : s;
    }
    case 'rotateCW':
    case 'rotateCCW': {
      const p = tryRotate(s.grid, cur, a.type === 'rotateCW' ? 1 : -1);
      return p ? { ...s, cur: p, lockAcc: 0 } : s;
    }
    case 'softDrop': {
      const p = tryMove(s.grid, cur, 0, 1);
      if (p) return { ...s, cur: p, fallAcc: 0 };
      return lockPair(s, cur);
    }
    case 'hardDrop':
      return lockPair(s, hardDropPair(s.grid, cur));
    default:
      return s;
  }
}

export function tick(s: State, dtMs: number): State {
  if (s.over) return s;
  let rem = Math.floor(dtMs);
  if (!(rem > 0)) return s;
  let st: State = { ...s };
  while (rem > 0 && !st.over) {
    const blocked = st.cur ? !canFall(st.grid, st.cur) : false;
    let until = rem;
    until = Math.min(until, st.durationMs - st.elapsedMs);
    until = Math.min(until, PERF_WINDOW_MS - st.windowMs);
    if (st.cur) until = Math.min(until, blocked ? LOCK_MS - st.lockAcc : st.fallMs - st.fallAcc);
    until = Math.max(1, until);
    st.elapsedMs += until;
    st.windowMs += until;
    if (st.cur) {
      if (blocked) st.lockAcc += until;
      else st.fallAcc += until;
    }
    rem -= until;
    if (st.windowMs >= PERF_WINDOW_MS) {
      st.windowMs -= PERF_WINDOW_MS;
      st.perf = ema(st.perf, clamp01(st.windowPower / 5), 0.4);
      st.windowPower = 0;
    }
    if (st.cur) {
      if (blocked) {
        if (st.lockAcc >= LOCK_MS) st = { ...lockPair(st, st.cur) };
      } else if (st.fallAcc >= st.fallMs) {
        st.fallAcc -= st.fallMs;
        const p = tryMove(st.grid, st.cur, 0, 1);
        if (p) {
          st.cur = p;
          if (!canFall(st.grid, p)) st.lockAcc = 0;
        }
      }
    }
    if (st.elapsedMs >= st.durationMs) st.over = true;
  }
  return st;
}

export function isOver(s: State): boolean {
  return s.over;
}

export function score(s: State): PuzzleScore {
  const performance = clamp01(s.perf);
  return { points: s.damageDealt * 10 + s.blocksCleared, performance, label: ratingLabel(performance) };
}

export const def: PuzzleDef<State, Action> = {
  id: 'swordfight',
  name: 'Swordfight',
  blurb: 'Drop pairs, cluster colours, and break them with a breaker to send sword strikes at your foes.',
  init,
  reduce,
  tick,
  isOver,
  score,
};

// ---------------------------------------------------------------------------
// Server helpers

/** Removes queued attacks; returns the same reference when there are none. */
export function drainOutgoing(s: State): [State, Attack[]] {
  if (s.outgoing.length === 0) return [s, []];
  return [{ ...s, outgoing: [] }, s.outgoing];
}

function mixedRow(rng: Rng): [Rng, number[]] {
  let r = rng;
  const row: number[] = [];
  for (let x = 0; x < COLS; x++) {
    let v: number;
    [r, v] = rngNext(r);
    if (v < 0.6) row.push(JUNK);
    else {
      let c: number;
      [r, c] = rngInt(r, NUM_COLORS);
      row.push(c);
    }
  }
  return [r, row];
}

/**
 * Builds a garbage pattern (rows, bottom-most first) for an attack of `power`:
 *  - 1–2: one row with 2–3 junk cells
 *  - 3–5: one full row of mixed junk/colours
 *  - 6–9: two mixed rows
 *  - 10+: three junk rows carrying a 4-connected diagonal "sword" of one colour
 */
export function garbagePatternFor(power: number, rng: Rng): [Rng, number[][]] {
  const p = Math.floor(power);
  let r = rng;
  if (!(p > 0)) return [r, []];
  if (p <= 2) {
    const count = p + 1;
    let cols: number[];
    [r, cols] = rngShuffle(r, [0, 1, 2, 3, 4, 5]);
    const row = new Array<number>(COLS).fill(GAP);
    for (let i = 0; i < count; i++) row[cols[i]!] = JUNK;
    return [r, [row]];
  }
  if (p <= 5) {
    let row: number[];
    [r, row] = mixedRow(r);
    return [r, [row]];
  }
  if (p <= 9) {
    let r0: number[];
    let r1: number[];
    [r, r0] = mixedRow(r);
    [r, r1] = mixedRow(r);
    return [r, [r0, r1]];
  }
  let color: number;
  let start: number;
  let flip: number;
  [r, color] = rngInt(r, NUM_COLORS);
  [r, start] = rngInt(r, COLS - 2);
  [r, flip] = rngInt(r, 2);
  const rows: number[][] = [];
  for (let i = 0; i < 3; i++) rows.push(new Array<number>(COLS).fill(JUNK));
  const col = (i: number) => (flip ? start + 2 - i : start + i);
  // Staircase blade: (c0,r0) (c0,r1) (c1,r1) (c1,r2) (c2,r2) — 4-connected.
  rows[0]![col(0)] = color;
  rows[1]![col(0)] = color;
  rows[1]![col(1)] = color;
  rows[2]![col(1)] = color;
  rows[2]![col(2)] = color;
  return [r, rows];
}

// ---------------------------------------------------------------------------
// AI

function evaluateGrid(grid: Cell[][]): number {
  let score = 0;
  let maxH = 0;
  for (let x = 0; x < COLS; x++) {
    const h = ROWS - 1 - restY(grid, x);
    if (h > maxH) maxH = h;
    score -= Math.pow(h, 1.5) * 0.6;
    if (x === SPAWN_X) score -= h * 2;
  }
  if (maxH >= ROWS - 2) score -= 60;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y]![x];
      if (!c || c.color < 0) continue;
      const right = x + 1 < COLS ? grid[y]![x + 1] : null;
      const down = y + 1 < ROWS ? grid[y + 1]![x] : null;
      if (right && right.color === c.color) score += 2;
      if (down && down.color === c.color) score += 2;
      if (c.breaker) {
        // A stored breaker with no same-colour neighbour is a wasted breaker.
        let near = false;
        for (const [dx, dy] of OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          const n = grid[ny]![nx];
          if (n && n.color === c.color) near = true;
        }
        if (!near) score -= 3;
      }
    }
  }
  return score;
}

/**
 * Deterministic 1-ply AI. Returns the action list (rotates, moves, hardDrop) that
 * places the current pair at the best-evaluated reachable spot. `skill` in 0..1
 * scales down the evaluation noise. Returns [] when there is no falling pair.
 */
export function aiChoose(state: State, rng: Rng, skill: number): [Rng, Action[]] {
  let r = rng;
  if (state.over || !state.cur) return [r, []];
  const cur = state.cur;
  const grid = state.grid;
  const noiseScale = 40 * (1 - clamp01(skill));
  let best = -Infinity;
  let bestActions: Action[] = [{ type: 'hardDrop' }];
  for (let dir = 0 as Dir; dir < 4; dir = (dir + 1) as Dir) {
    const rot = (dir - cur.dir + 4) % 4;
    for (let x = 0; x < COLS; x++) {
      let p: Pair = cur;
      const acts: Action[] = [];
      let ok = true;
      if (rot === 3) {
        const q = tryRotate(grid, p, -1);
        if (!q) ok = false;
        else {
          p = q;
          acts.push({ type: 'rotateCCW' });
        }
      } else {
        for (let i = 0; i < rot && ok; i++) {
          const q = tryRotate(grid, p, 1);
          if (!q) ok = false;
          else {
            p = q;
            acts.push({ type: 'rotateCW' });
          }
        }
      }
      if (!ok) continue;
      const step = x > p.x ? 1 : -1;
      while (p.x !== x) {
        const q = tryMove(grid, p, step, 0);
        if (!q) {
          ok = false;
          break;
        }
        p = q;
        acts.push({ type: step > 0 ? 'right' : 'left' });
      }
      if (!ok || p.dir !== dir) continue;
      const placed = cloneGrid(grid);
      for (const c of pairCells(hardDropPair(grid, p))) placed[c.y]![c.x] = c.block;
      const res = resolveGrid(applyGravity(placed)[0]);
      let v = evaluateGrid(res.grid) + attackPowerFor(res.passes) * 40 + res.clears.length * 6;
      if (noiseScale > 0) {
        let n: number;
        [r, n] = rngNext(r);
        v += (n - 0.5) * noiseScale;
      }
      if (v > best) {
        best = v;
        acts.push({ type: 'hardDrop' });
        bestActions = acts;
      }
    }
  }
  return [r, bestActions];
}
