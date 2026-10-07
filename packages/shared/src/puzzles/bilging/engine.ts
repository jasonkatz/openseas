/**
 * Bilging — match-3 swap puzzle with rising water.
 *
 * Board is COLS × ROWS, indexed `idx(x, y) = y * COLS + x` with y = 0 at the TOP.
 * Gravity pulls pieces toward higher y; new pieces enter at y = 0.
 *
 * Pure engine: no Math.random / Date.now. All randomness comes from `state.rng`.
 */
import { rngFromSeed, rngInt, rngNext, type Rng } from '../../rng';
import { clamp01, ema, ratingLabel, type BasePuzzleState, type PuzzleConfig, type PuzzleDef, type PuzzleScore } from '../types';

export const COLS = 6;
export const ROWS = 12;
export const CELLS = COLS * ROWS;
/** Number of ordinary colours (indices 0..KINDS-1). */
export const KINDS = 7;
/** Wild piece: matches any colour. */
export const CRAB = 7;
/** Swapping a puffer clears the 3×3 around its destination. */
export const PUFFER = 8;
/** Swapping a jelly clears every piece of the colour it was swapped with. */
export const JELLY = 9;

export type Piece = number;

/** Specials only spawn after this much elapsed time. */
export const SPECIALS_AFTER_MS = 10_000;
export const PUFFER_CHANCE = 0.015;
export const JELLY_CHANCE = 0.007;
export const CRAB_CHANCE = 0.02;

/** Water drops this much per point scored. */
export const WATER_PER_POINT = 0.004;
/** Points-per-second that counts as a perfect (1.0) performance. */
export const PERF_FULL_RATE = 8;
/** The EMA is capped here so a burst of play can't bank an unbounded buffer against idle decay. */
export const PERF_RATE_CAP = PERF_FULL_RATE * 1.5;
/** Time window (ms) of the performance EMA. */
export const PERF_WINDOW_MS = 15_000;
/** Fixed simulation step for tick (ms). */
export const STEP_MS = 100;

export interface Clear {
  /** Cell indices (idx) cleared by this event. */
  cells: number[];
  /** Colour of the run (0..6), or CRAB for an all-crab run, or the special id for puffer/jelly bursts. */
  colour: number;
  size: number;
  kind: 'run' | 'puffer' | 'jelly';
}

export interface Fall {
  x: number;
  /** Row the piece fell from; negative when it entered from above the board. */
  fromY: number;
  toY: number;
}

/** One cascade step: the board as it looked before `clears` were removed, and how pieces then fell. */
export interface Step {
  board: Piece[];
  clears: Clear[];
  falls: Fall[];
}

export interface State extends BasePuzzleState {
  board: Piece[];
  points: number;
  /** 0..1, game over at 1. */
  water: number;
  difficulty: number;
  durationMs: number;
  /** Increments on every accepted swap. */
  swapSeq: number;
  /** Increments whenever a swap produced at least one clear. */
  clearSeq: number;
  /** The last accepted swap (left cell of the pair). */
  lastSwap: { x: number; y: number } | null;
  /** All clears produced by the last swap (every cascade), flattened. */
  lastClears: Clear[];
  /** Cascade steps of the last swap, in order. Empty if the swap cleared nothing. */
  lastSteps: Step[];
  /** Number of runs (incl. specials) cleared by the last swap across all cascades. */
  lastCombo: number;
  /** Number of cascade steps of the last swap. */
  lastCascades: number;
  /** Points earned by the last swap. */
  lastPoints: number;
  /** Points-per-second EMA. */
  perfRate: number;
  /** Points scored since the last simulation step consumed them. */
  ptsSinceTick: number;
  /** Fractional-step accumulator so tick(a)+tick(b) == tick(a+b). */
  accMs: number;
  endReason: 'flooded' | 'time' | null;
}

export type Action = { type: 'swap'; x: number; y: number };

export function idx(x: number, y: number): number {
  return y * COLS + x;
}

export function isColour(p: Piece): boolean {
  return p >= 0 && p < KINDS;
}

/** A piece that can be the "colour" of a jelly burst (colours and crabs). */
export function isColourish(p: Piece): boolean {
  return isColour(p) || p === CRAB;
}

/** Points for a straight run of `size` pieces. */
export function runPoints(size: number): number {
  if (size < 3) return 0;
  if (size <= 5) return (size - 2) * (size - 2) * 3;
  return 27 + (size - 5) * 20;
}

/** Points for a special (puffer/jelly) burst of `size` cells: every 3 cells counts as a 3-run. */
export function burstPoints(size: number): number {
  return 3 * Math.ceil(size / 3);
}

export function clearPoints(c: Clear): number {
  return c.kind === 'run' ? runPoints(c.size) : burstPoints(c.size);
}

/** Water rise per ms at a given difficulty (fills in ~60s at difficulty 0.4 when idle). */
export function waterRatePerMs(difficulty: number): number {
  const d = clamp01(difficulty);
  return (0.4 + 1.5 * d) / 60_000;
}

/** Points earned from the clears of a cascade step with `cascade` (0-based) applied. */
export function stepPoints(clears: readonly Clear[], cascade: number): number {
  if (clears.length === 0) return 0;
  let base = 0;
  for (const c of clears) base += clearPoints(c);
  const comboMul = 1 + 0.5 * (clears.length - 1);
  return Math.round(base * comboMul * (cascade + 1));
}

// ---------------------------------------------------------------------------
// Run detection

function runsInLine(board: readonly Piece[], cells: readonly number[], out: Clear[]): void {
  const n = cells.length;
  let prevStart = -1;
  let prevEnd = -1;
  for (let i = 0; i < n; i++) {
    const first = board[cells[i]!]!;
    if (!isColourish(first)) continue;
    let colour = first === CRAB ? -1 : first;
    let j = i + 1;
    for (; j < n; j++) {
      const p = board[cells[j]!]!;
      if (p === CRAB) continue;
      if (!isColour(p)) break;
      if (colour === -1) colour = p;
      else if (p !== colour) break;
    }
    const len = j - i;
    if (len >= 3 && !(i >= prevStart && j <= prevEnd)) {
      const run: number[] = [];
      for (let k = i; k < j; k++) run.push(cells[k]!);
      out.push({ cells: run, colour: colour === -1 ? CRAB : colour, size: len, kind: 'run' });
      prevStart = i;
      prevEnd = j;
    }
  }
}

/** Finds every maximal horizontal/vertical run of 3+ matching pieces (crab is wild). */
export function findRuns(board: readonly Piece[]): Clear[] {
  const out: Clear[] = [];
  const line: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    line.length = 0;
    for (let x = 0; x < COLS; x++) line.push(idx(x, y));
    runsInLine(board, line, out);
  }
  for (let x = 0; x < COLS; x++) {
    line.length = 0;
    for (let y = 0; y < ROWS; y++) line.push(idx(x, y));
    runsInLine(board, line, out);
  }
  return out;
}

function pufferClear(x: number, y: number): Clear {
  const cells: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) cells.push(idx(cx, cy));
    }
  }
  return { cells, colour: PUFFER, size: cells.length, kind: 'puffer' };
}

function jellyClear(board: readonly Piece[], colour: Piece, jellyCell: number): Clear {
  const cells: number[] = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === colour) cells.push(i);
  cells.push(jellyCell);
  return { cells, colour, size: cells.length, kind: 'jelly' };
}

// ---------------------------------------------------------------------------
// Piece generation & gravity

function drawPiece(rng: Rng, allowSpecials: boolean): [Rng, Piece] {
  let r = rng;
  if (allowSpecials) {
    let roll: number;
    [r, roll] = rngNext(r);
    if (roll < PUFFER_CHANCE) return [r, PUFFER];
    if (roll < PUFFER_CHANCE + JELLY_CHANCE) return [r, JELLY];
    if (roll < PUFFER_CHANCE + JELLY_CHANCE + CRAB_CHANCE) return [r, CRAB];
  }
  return rngInt(r, KINDS);
}

/** Removes `cleared` cells, drops pieces, refills from the top. */
export function applyGravity(
  board: readonly Piece[],
  cleared: readonly boolean[],
  rng: Rng,
  allowSpecials: boolean,
): { board: Piece[]; falls: Fall[]; rng: Rng } {
  const next: Piece[] = new Array(CELLS).fill(0);
  const falls: Fall[] = [];
  let r = rng;
  for (let x = 0; x < COLS; x++) {
    let w = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      const i = idx(x, y);
      if (cleared[i]) continue;
      next[idx(x, w)] = board[i]!;
      if (w !== y) falls.push({ x, fromY: y, toY: w });
      w--;
    }
    const n = w + 1;
    for (let k = w; k >= 0; k--) {
      let p: Piece;
      [r, p] = drawPiece(r, allowSpecials);
      next[idx(x, k)] = p;
      falls.push({ x, fromY: k - n, toY: k });
    }
  }
  return { board: next, falls, rng: r };
}

/** Deterministic board with no pre-existing runs. */
export function generateBoard(rng: Rng): [Rng, Piece[]] {
  const board: Piece[] = new Array(CELLS).fill(0);
  let r = rng;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let c = 0;
      let ok = false;
      for (let tries = 0; tries < 24 && !ok; tries++) {
        [r, c] = rngInt(r, KINDS);
        ok = !wouldRun(board, x, y, c);
      }
      if (!ok) {
        // Exhaustively pick the first legal colour (always exists: at most 2 are forbidden).
        for (c = 0; c < KINDS; c++) if (!wouldRun(board, x, y, c)) break;
      }
      board[idx(x, y)] = c;
    }
  }
  return [r, board];
}

function wouldRun(board: readonly Piece[], x: number, y: number, c: Piece): boolean {
  if (x >= 2 && board[idx(x - 1, y)] === c && board[idx(x - 2, y)] === c) return true;
  if (y >= 2 && board[idx(x, y - 1)] === c && board[idx(x, y - 2)] === c) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Engine

export function init(seed: number, config: PuzzleConfig = {}): State {
  const difficulty = clamp01(config.difficulty ?? 0.4);
  const durationMs = Math.max(1000, Math.floor(config.durationMs ?? 150_000));
  const [rng, board] = generateBoard(rngFromSeed(seed));
  return {
    rng,
    elapsedMs: 0,
    over: false,
    board,
    points: 0,
    water: 0,
    difficulty,
    durationMs,
    swapSeq: 0,
    clearSeq: 0,
    lastSwap: null,
    lastClears: [],
    lastSteps: [],
    lastCombo: 0,
    lastCascades: 0,
    lastPoints: 0,
    perfRate: 0,
    ptsSinceTick: 0,
    accMs: 0,
    endReason: null,
  };
}

function isValidSwap(a: Action): boolean {
  return (
    a != null &&
    a.type === 'swap' &&
    Number.isInteger(a.x) &&
    Number.isInteger(a.y) &&
    a.x >= 0 &&
    a.x < COLS - 1 &&
    a.y >= 0 &&
    a.y < ROWS
  );
}

export function reduce(state: State, action: Action): State {
  if (state.over || !isValidSwap(action)) return state;
  const { x, y } = action;
  const a = idx(x, y);
  const b = idx(x + 1, y);
  let board = state.board.slice();
  const pa = board[a]!;
  const pb = board[b]!;
  board[a] = pb;
  board[b] = pa;

  // Special effects triggered by the swap itself (pa now sits at b, pb at a).
  const special: Clear[] = [];
  if (pa === PUFFER) special.push(pufferClear(x + 1, y));
  if (pb === PUFFER) special.push(pufferClear(x, y));
  if (pa === JELLY && isColourish(pb)) special.push(jellyClear(board, pb, b));
  if (pb === JELLY && isColourish(pa)) special.push(jellyClear(board, pa, a));
  if (pa === JELLY && pb === JELLY) special.push({ cells: [a, b], colour: JELLY, size: 2, kind: 'jelly' });

  const allowSpecials = state.elapsedMs >= SPECIALS_AFTER_MS;
  let rng = state.rng;
  const steps: Step[] = [];
  const allClears: Clear[] = [];
  let total = 0;
  let combo = 0;
  for (let cascade = 0; cascade < 64; cascade++) {
    const runs = findRuns(board);
    const clears = cascade === 0 ? special.concat(runs) : runs;
    if (clears.length === 0) break;
    total += stepPoints(clears, cascade);
    combo += clears.length;
    const mask: boolean[] = new Array(CELLS).fill(false);
    for (const c of clears) for (const cell of c.cells) mask[cell] = true;
    const g = applyGravity(board, mask, rng, allowSpecials);
    steps.push({ board, clears, falls: g.falls });
    for (const c of clears) allClears.push(c);
    board = g.board;
    rng = g.rng;
  }

  const cleared = steps.length > 0;
  return {
    ...state,
    rng,
    board,
    points: state.points + total,
    water: cleared ? Math.max(0, state.water - total * WATER_PER_POINT) : state.water,
    swapSeq: state.swapSeq + 1,
    clearSeq: cleared ? state.clearSeq + 1 : state.clearSeq,
    lastSwap: { x, y },
    lastClears: allClears,
    lastSteps: steps,
    lastCombo: combo,
    lastCascades: steps.length,
    lastPoints: total,
    ptsSinceTick: state.ptsSinceTick + total,
  };
}

export function tick(state: State, dtMs: number): State {
  if (state.over) return state;
  const dt = Math.floor(dtMs);
  if (dt <= 0) return state;
  let elapsedMs = state.elapsedMs + dt;
  let accMs = state.accMs + dt;
  let water = state.water;
  let perfRate = state.perfRate;
  let pts = state.ptsSinceTick;
  let over = false;
  let endReason: State['endReason'] = null;
  const rate = waterRatePerMs(state.difficulty);
  const alpha = STEP_MS / PERF_WINDOW_MS;
  while (accMs >= STEP_MS) {
    accMs -= STEP_MS;
    const sample = pts / (STEP_MS / 1000);
    pts = 0;
    perfRate = Math.min(PERF_RATE_CAP, ema(perfRate, sample, alpha));
    water += rate * STEP_MS;
    if (water >= 1) {
      water = 1;
      over = true;
      endReason = 'flooded';
      break;
    }
  }
  if (!over && elapsedMs >= state.durationMs) {
    elapsedMs = state.durationMs;
    over = true;
    endReason = 'time';
  }
  return { ...state, elapsedMs, accMs, water, perfRate, ptsSinceTick: pts, over, endReason };
}

export function isOver(state: State): boolean {
  return state.over;
}

export function score(state: State): PuzzleScore {
  const rating = clamp01(state.perfRate / PERF_FULL_RATE);
  const performance = clamp01(rating * (1 - 0.5 * clamp01(state.water)));
  return { points: state.points, performance, label: ratingLabel(performance) };
}

export const def: PuzzleDef<State, Action> = {
  id: 'bilging',
  name: 'Bilging',
  blurb: 'Swap neighbouring pieces to line up three or more. Bigger matches and combos pump more water.',
  init,
  reduce,
  tick,
  isOver,
  score,
};
