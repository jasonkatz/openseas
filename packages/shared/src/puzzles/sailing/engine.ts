/**
 * Sailing — Columns-style falling trios.
 *
 * A vertical trio of coloured blocks falls into a 6×13 well. The player slides it
 * left/right, cycles the colours, and drops it. On lock, every line of 3+ matching
 * colours (horizontal, vertical, both diagonals) clears; blocks fall and cascades
 * chain. A rare "wind gust" block (colour index 7, "bone") clears every block of
 * the colour directly beneath it when it lands.
 *
 * Pure, deterministic, JSON-serialisable. Time is advanced event-by-event in `tick`
 * so any partition of a dt yields byte-identical state.
 */
import { rngFromSeed, rngInt, rngNext, type Rng } from '../../rng';
import {
  clamp01,
  ema,
  ratingLabel,
  type BasePuzzleState,
  type PuzzleConfig,
  type PuzzleDef,
  type PuzzleScore,
} from '../types';

export const COLS = 6;
export const ROWS = 13;
export const EMPTY = -1;
/** Colour index of the wind-gust special block (PIECE_COLORS[7] "bone"). */
export const GUST = 7;
/** Column the trio spawns in. */
export const SPAWN_COL = 2;
/** Row of the trio's top block at spawn (bottom block sits in row 0). */
export const SPAWN_ROW = -2;
export const LOCK_MS = 300;
export const MIN_FALL_MS = 250;
export const GUST_CHANCE = 0.03;
/** performance sampling: one sample every window, EMA time constant, normalisation. */
export const PERF_WINDOW_MS = 100;
export const PERF_TAU_MS = 15000;
export const PERF_PTS_PER_SEC = 6;
export const DEFAULT_DURATION_MS = 150000;

export type Trio = [number, number, number];

export interface Piece {
  col: number;
  /** Row of the top block. Blocks occupy rows row, row+1, row+2. May be negative near spawn. */
  row: number;
  /** [top, middle, bottom] colours (0..5, or GUST). */
  colors: Trio;
}

export interface ClearLine {
  /** Grid cell indexes (row * COLS + col) that were cleared. */
  cells: number[];
  /** Colour index that was cleared (GUST when a gust cleared only itself). */
  color: number;
  /** Number of blocks cleared. */
  size: number;
  /** Cascade step: 0 for gust clears, 1.. for successive line clears. */
  step: number;
  /** True when this clear came from a wind gust rather than a line. */
  gust: boolean;
}

export interface State extends BasePuzzleState {
  cols: number;
  rows: number;
  /** Row-major cells: EMPTY or a colour index 0..5. Gusts never rest in the grid. */
  grid: number[];
  piece: Piece | null;
  next: Trio;
  /** ms accumulated towards the next gravity step (0 while resting). */
  fallAcc: number;
  /** Current gravity interval in ms. */
  fallMs: number;
  /** ms accumulated while resting on something; locks at LOCK_MS. */
  lockAcc: number;
  difficulty: number;
  durationMs: number;
  nColors: number;
  points: number;
  /** Smoothed recent points-per-second rating 0..1. */
  performance: number;
  /** Same as performance; the ship reads this. */
  sailPower: number;
  perfAcc: number;
  windowPts: number;
  /** Cascade length of the last lock (0 when nothing cleared). */
  chain: number;
  /** Increments on each lock that cleared something. */
  clearSeq: number;
  /** Increments on every lock. */
  lockSeq: number;
  /** Everything cleared by the last lock, in cascade order. */
  lastClears: ClearLine[];
  toppedOut: boolean;
}

export type Action =
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'cycle' }
  | { type: 'softDrop' }
  | { type: 'hardDrop' };

export function cellIndex(row: number, col: number): number {
  return row * COLS + col;
}

export function fallMsFor(difficulty: number, elapsedMs: number): number {
  const d = clamp01(difficulty);
  const base = Math.round(900 - 500 * d);
  const ramp = Math.floor(elapsedMs / 1000) * 2;
  return Math.max(MIN_FALL_MS, base - ramp);
}

/** True when a trio with its top block at `row` can sit in `col` (rows above 0 only need the column to exist). */
export function canOccupy(grid: readonly number[], col: number, row: number): boolean {
  if (col < 0 || col >= COLS) return false;
  for (let k = 0; k < 3; k++) {
    const r = row + k;
    if (r >= ROWS) return false;
    if (r >= 0 && grid[cellIndex(r, col)] !== EMPTY) return false;
  }
  return true;
}

/** Row the current piece's top block would rest at if dropped straight down. */
export function landingRow(grid: readonly number[], piece: Piece): number {
  let row = piece.row;
  while (canOccupy(grid, piece.col, row + 1)) row++;
  return row;
}

function rollTrio(rng: Rng, nColors: number): [Rng, Trio] {
  let r = rng;
  let a: number, b: number, c: number, roll: number;
  [r, a] = rngInt(r, nColors);
  [r, b] = rngInt(r, nColors);
  [r, c] = rngInt(r, nColors);
  [r, roll] = rngNext(r);
  const trio: Trio = [a, b, c];
  if (roll < GUST_CHANCE) {
    let slot: number;
    [r, slot] = rngInt(r, 3);
    trio[slot] = GUST;
  }
  return [r, trio];
}

const DIRS: readonly (readonly [number, number])[] = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
];

export interface Line {
  cells: number[];
  color: number;
  size: number;
}

/** All runs of 3+ identical colours in any of the four directions. */
export function findLines(grid: readonly number[]): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const color = grid[cellIndex(r, c)];
      if (color === undefined || color === EMPTY || color === GUST) continue;
      for (const [dr, dc] of DIRS) {
        const pr = r - dr;
        const pc = c - dc;
        if (pr >= 0 && pr < ROWS && pc >= 0 && pc < COLS && grid[cellIndex(pr, pc)] === color) continue; // not a run start
        const cells: number[] = [];
        let rr = r;
        let cc = c;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[cellIndex(rr, cc)] === color) {
          cells.push(cellIndex(rr, cc));
          rr += dr;
          cc += dc;
        }
        if (cells.length >= 3) lines.push({ cells, color, size: cells.length });
      }
    }
  }
  return lines;
}

export function lineScore(size: number): number {
  if (size >= 5) return 25;
  if (size === 4) return 12;
  return 5;
}

/** Drops every block to the lowest empty cell in its column. Returns a new array. */
export function applyGravity(grid: readonly number[]): number[] {
  const out = new Array<number>(ROWS * COLS).fill(EMPTY);
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = grid[cellIndex(r, c)];
      if (v !== undefined && v !== EMPTY) {
        out[cellIndex(write, c)] = v;
        write--;
      }
    }
  }
  return out;
}

/** Places the current piece, resolves gusts + cascades, awards points and spawns the next trio. */
function lockPiece(state: State): State {
  const piece = state.piece;
  if (!piece) return state;
  const grid = state.grid.slice();
  let topped = false;
  for (let k = 0; k < 3; k++) {
    const r = piece.row + k;
    if (r < 0) {
      topped = true;
      continue;
    }
    grid[cellIndex(r, piece.col)] = piece.colors[k] as number;
  }

  const clears: ClearLine[] = [];
  let points = 0;

  // Wind gusts: clear every block of the colour directly beneath.
  for (let k = 2; k >= 0; k--) {
    if (piece.colors[k] !== GUST) continue;
    const r = piece.row + k;
    if (r < 0) continue;
    const self = cellIndex(r, piece.col);
    const below = r + 1 < ROWS ? grid[cellIndex(r + 1, piece.col)] : EMPTY;
    if (below !== undefined && below !== EMPTY && below !== GUST) {
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === below) {
          cells.push(i);
          grid[i] = EMPTY;
        }
      }
      grid[self] = EMPTY;
      clears.push({ cells, color: below, size: cells.length, step: 0, gust: true });
      points += cells.length;
    } else {
      grid[self] = EMPTY;
      clears.push({ cells: [self], color: GUST, size: 0, step: 0, gust: true });
    }
  }

  let settled = clears.length > 0 ? applyGravity(grid) : grid;
  let chain = 0;
  for (;;) {
    const lines = findLines(settled);
    if (lines.length === 0) break;
    chain++;
    let sum = 0;
    for (const line of lines) {
      sum += lineScore(line.size);
      for (const i of line.cells) settled[i] = EMPTY;
      clears.push({ cells: line.cells, color: line.color, size: line.size, step: chain, gust: false });
    }
    points += Math.round(sum * chain * (lines.length >= 2 ? 1.5 : 1));
    settled = applyGravity(settled);
  }

  const over = topped || !canOccupy(settled, SPAWN_COL, SPAWN_ROW);
  let rng = state.rng;
  let next = state.next;
  let nextPiece: Piece | null = null;
  if (!over) {
    nextPiece = { col: SPAWN_COL, row: SPAWN_ROW, colors: state.next };
    [rng, next] = rollTrio(rng, state.nColors);
  }

  return {
    ...state,
    rng,
    grid: settled,
    piece: nextPiece,
    next,
    fallAcc: 0,
    lockAcc: 0,
    points: state.points + points,
    windowPts: state.windowPts + points,
    chain,
    clearSeq: clears.length > 0 ? state.clearSeq + 1 : state.clearSeq,
    lockSeq: state.lockSeq + 1,
    lastClears: clears,
    over: over || state.over,
    toppedOut: over,
  };
}

function init(seed: number, config?: PuzzleConfig): State {
  const difficulty = clamp01(config?.difficulty ?? 0.4);
  const durationMs = Math.max(1000, Math.floor(config?.durationMs ?? DEFAULT_DURATION_MS));
  const nColors = difficulty < 0.5 ? 5 : 6;
  let rng = rngFromSeed(seed);
  let first: Trio;
  let next: Trio;
  [rng, first] = rollTrio(rng, nColors);
  [rng, next] = rollTrio(rng, nColors);
  return {
    rng,
    elapsedMs: 0,
    over: false,
    cols: COLS,
    rows: ROWS,
    grid: new Array<number>(ROWS * COLS).fill(EMPTY),
    piece: { col: SPAWN_COL, row: SPAWN_ROW, colors: first },
    next,
    fallAcc: 0,
    fallMs: fallMsFor(difficulty, 0),
    lockAcc: 0,
    difficulty,
    durationMs,
    nColors,
    points: 0,
    performance: 0,
    sailPower: 0,
    perfAcc: 0,
    windowPts: 0,
    chain: 0,
    clearSeq: 0,
    lockSeq: 0,
    lastClears: [],
    toppedOut: false,
  };
}

function reduce(state: State, action: Action): State {
  if (state.over) return state;
  const piece = state.piece;
  if (!piece) return state;
  switch (action.type) {
    case 'left':
    case 'right': {
      const col = piece.col + (action.type === 'left' ? -1 : 1);
      if (!canOccupy(state.grid, col, piece.row)) return state;
      return { ...state, piece: { ...piece, col }, lockAcc: 0 };
    }
    case 'cycle': {
      const [a, b, c] = piece.colors;
      return { ...state, piece: { ...piece, colors: [c, a, b] }, lockAcc: 0 };
    }
    case 'softDrop': {
      if (canOccupy(state.grid, piece.col, piece.row + 1)) {
        return { ...state, piece: { ...piece, row: piece.row + 1 }, fallAcc: 0, lockAcc: 0 };
      }
      return lockPiece(state);
    }
    case 'hardDrop': {
      const row = landingRow(state.grid, piece);
      return lockPiece({ ...state, piece: { ...piece, row } });
    }
    default:
      return state;
  }
}

function tick(state: State, dtMs: number): State {
  let remaining = Math.floor(dtMs);
  if (state.over || remaining <= 0) return state;
  let s: State = { ...state };
  while (remaining > 0 && !s.over) {
    const piece = s.piece;
    if (!piece) {
      s.over = true;
      break;
    }
    s.fallMs = fallMsFor(s.difficulty, s.elapsedMs);
    const canFall = canOccupy(s.grid, piece.col, piece.row + 1);
    if (!canFall) s.fallAcc = 0;
    const toEvent = canFall ? s.fallMs - s.fallAcc : LOCK_MS - s.lockAcc;
    const toPerf = PERF_WINDOW_MS - s.perfAcc;
    const toSecond = 1000 - (s.elapsedMs % 1000);
    const toEnd = s.durationMs - s.elapsedMs;
    const step = Math.max(1, Math.min(remaining, toEvent, toPerf, toSecond, toEnd));

    s.elapsedMs += step;
    remaining -= step;
    s.perfAcc += step;
    if (canFall) s.fallAcc += step;
    else s.lockAcc += step;

    if (s.perfAcc >= PERF_WINDOW_MS) {
      s.perfAcc -= PERF_WINDOW_MS;
      const rate = s.windowPts * (1000 / PERF_WINDOW_MS);
      const sample = rate / PERF_PTS_PER_SEC;
      s.performance = clamp01(ema(s.performance, sample, PERF_WINDOW_MS / PERF_TAU_MS));
      s.sailPower = s.performance;
      s.windowPts = 0;
    }

    if (canFall) {
      if (s.fallAcc >= s.fallMs) {
        s.fallAcc = 0;
        s.lockAcc = 0;
        s.piece = { ...piece, row: piece.row + 1 };
      }
    } else if (s.lockAcc >= LOCK_MS) {
      s = lockPiece(s);
    }

    if (s.elapsedMs >= s.durationMs) s.over = true;
  }
  return s;
}

function isOver(state: State): boolean {
  return state.over;
}

function score(state: State): PuzzleScore {
  return { points: state.points, performance: state.performance, label: ratingLabel(state.performance) };
}

/** Sail power 0..1 for the ship (identical to performance). */
export function sailPower(state: State): number {
  return state.sailPower;
}

export const def: PuzzleDef<State, Action> = {
  id: 'sailing',
  name: 'Sailing',
  blurb: 'Guide falling trios into lines of three or more — any direction. Chains catch more wind.',
  init,
  reduce,
  tick,
  isOver,
  score,
};
