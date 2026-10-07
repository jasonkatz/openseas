/**
 * Gunnery — line-clear stacking on the gun deck.
 *
 * Tetrominoes made of powder / wadding / shot fall into an 8x14 well
 * (rows 0–1 are spawn space). Completing a row loads a cannon. A row that
 * holds at least 2 powder, 1 wad and 1 shot is "primed" and worth 1.5x.
 * Every 20s a damp row of garbage with one gap rises from the bilge.
 *
 * Pure, deterministic. Time advances in fixed 50ms steps so split/merged ticks
 * produce identical state. `elapsedMs` is therefore always a multiple of STEP;
 * the sub-step remainder lives in `stepAccMs`.
 */
import { rngFromSeed, rngInt, rngShuffle, type Rng } from '../../rng';
import { clamp01, ema, ratingLabel, type PuzzleConfig, type PuzzleDef, type PuzzleScore, type BasePuzzleState } from '../types';

export const COLS = 8;
export const ROWS = 14;
export const SPAWN_ROWS = 2;
export const STEP_MS = 50;
export const LOCK_DELAY_MS = 400;
export const MAX_LOCK_RESETS = 10;
export const GARBAGE_INTERVAL_MS = 20000;
export const GARBAGE_MIN_DIFFICULTY = 0.3;
export const MAX_CANNONS = 24;
export const NEXT_COUNT = 3;
export const MIN_GRAVITY_MS = 200;
export const DEFAULT_DURATION_MS = 150000;
/** Points per rows-cleared-at-once (index = rows). */
export const CLEAR_POINTS = [0, 10, 25, 45, 80] as const;
export const PRIMED_MULT = 1.5;
/** Points-per-second that maps to performance 1.0. */
export const PERF_PPS_FULL = 4;

export type Kind = 'powder' | 'wad' | 'shot';
export const KINDS: readonly Kind[] = ['powder', 'wad', 'shot'];
/** Weighted draw pool: powder is a little more common so primed rows are reachable. */
const KIND_POOL: readonly Kind[] = ['powder', 'powder', 'wad', 'shot'];
/** PIECE_COLORS index for each kind (amber / bone / blue). */
export const KIND_COLOR: Record<Kind, number> = { powder: 1, wad: 7, shot: 3 };

export type Cell = Kind | 'damp' | null;

export type Shape = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const SHAPES: readonly Shape[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export interface PieceSpec { shape: Shape; kind: Kind }
export interface Piece extends PieceSpec {
  /** Rotation 0..3 (clockwise). */
  rot: number;
  /** Top-left of the shape's bounding box in grid coords. */
  x: number;
  y: number;
}

export interface Pt { x: number; y: number }

export type Action =
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'rotateCW' }
  | { type: 'rotateCCW' }
  | { type: 'softDrop' }
  | { type: 'hardDrop' }
  | { type: 'hold' };

export interface State extends BasePuzzleState {
  cols: number;
  rows: number;
  spawnRows: number;
  /** grid[row][col], row 0 at the top. */
  grid: Cell[][];
  active: Piece | null;
  next: PieceSpec[];
  /** Remaining shapes in the current 7-bag. */
  bag: Shape[];
  hold: PieceSpec | null;
  holdUsed: boolean;
  /** Increments on every spawn. */
  pieceSeq: number;
  /** Increments on every lock. */
  lockSeq: number;
  points: number;
  cannonsLoaded: number;
  /** Rows cleared by the most recent lock. */
  lastClears: number;
  /** Grid row indices (pre-collapse) of the most recent clear. */
  lastClearRows: number[];
  /** Increments on every lock that cleared >= 1 row. */
  clearSeq: number;
  /** Whether every row of the most recent clear was primed. */
  lastPrimed: boolean;
  /** Total rows cleared and total primed rows, for stats. */
  totalRows: number;
  primedRows: number;
  gravityAccMs: number;
  lockMs: number;
  lockResets: number;
  garbageTimerMs: number;
  /** Increments every time a damp row rises. */
  garbageSeq: number;
  /** Sub-step time not yet simulated (0..STEP_MS-1). */
  stepAccMs: number;
  perfTimerMs: number;
  /** Points earned since the last performance sample. */
  perfPts: number;
  /** EMA of normalised points-per-second. */
  perf: number;
  difficulty: number;
  durationMs: number;
  topOut: boolean;
}

// ---------------------------------------------------------------------------
// Shapes

const BASE: Record<Shape, readonly string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
};

function rotateGrid(g: readonly string[]): string[] {
  const n = g.length;
  const out: string[] = [];
  for (let r = 0; r < n; r++) {
    let row = '';
    for (let c = 0; c < n; c++) row += (g[n - 1 - c] as string)[r] ?? '.';
    out.push(row);
  }
  return out;
}

function toCells(g: readonly string[]): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < g.length; y++) {
    const row = g[y] as string;
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') out.push({ x, y });
  }
  return out;
}

/** SHAPE_CELLS[shape][rot] = cell offsets within the bounding box. */
export const SHAPE_CELLS: Record<Shape, readonly (readonly Pt[])[]> = (() => {
  const out = {} as Record<Shape, readonly (readonly Pt[])[]>;
  for (const s of SHAPES) {
    let g: readonly string[] = BASE[s];
    const rots: Pt[][] = [];
    for (let r = 0; r < 4; r++) {
      rots.push(toCells(g));
      g = rotateGrid(g);
    }
    out[s] = rots;
  }
  return out;
})();

export const SHAPE_SIZE: Record<Shape, number> = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 };

const KICKS = [0, -1, 1, -2, 2] as const;

/** Absolute grid cells of a piece. */
export function pieceCells(p: Piece): Pt[] {
  const rel = SHAPE_CELLS[p.shape][p.rot & 3] as readonly Pt[];
  const out: Pt[] = new Array(rel.length);
  for (let i = 0; i < rel.length; i++) {
    const c = rel[i] as Pt;
    out[i] = { x: p.x + c.x, y: p.y + c.y };
  }
  return out;
}

export function fits(s: State, shape: Shape, rot: number, x: number, y: number): boolean {
  const rel = SHAPE_CELLS[shape][rot & 3] as readonly Pt[];
  for (let i = 0; i < rel.length; i++) {
    const c = rel[i] as Pt;
    const gx = x + c.x;
    const gy = y + c.y;
    if (gx < 0 || gx >= s.cols || gy < 0 || gy >= s.rows) return false;
    if ((s.grid[gy] as Cell[])[gx] !== null) return false;
  }
  return true;
}

function spawnX(s: State, shape: Shape): number {
  return Math.floor((s.cols - SHAPE_SIZE[shape]) / 2);
}

/** Lowest y the active piece can drop to (for the ghost). */
export function ghostY(s: State): number {
  const p = s.active;
  if (!p) return 0;
  let y = p.y;
  while (fits(s, p.shape, p.rot, p.x, y + 1)) y++;
  return y;
}

/** Height of the stack in rows (0 = empty). */
export function stackHeight(s: State): number {
  for (let r = 0; r < s.rows; r++) {
    const row = s.grid[r] as Cell[];
    for (let c = 0; c < s.cols; c++) if (row[c] !== null) return s.rows - r;
  }
  return 0;
}

/** A full row with >= 2 powder, >= 1 wad and >= 1 shot. */
export function isPrimedRow(row: readonly Cell[]): boolean {
  let p = 0, w = 0, sh = 0;
  for (const c of row) {
    if (c === 'powder') p++;
    else if (c === 'wad') w++;
    else if (c === 'shot') sh++;
  }
  return p >= 2 && w >= 1 && sh >= 1;
}

export function clearPoints(rows: number, primed: boolean): number {
  const base = CLEAR_POINTS[Math.min(rows, CLEAR_POINTS.length - 1)] as number;
  return primed && rows > 0 ? Math.round(base * PRIMED_MULT) : base;
}

/** Gravity interval in ms for the current difficulty and elapsed time. */
export function gravityMs(difficulty: number, elapsedMs: number, durationMs: number): number {
  const base = 1100 - difficulty * 750; // 0.4 -> 800
  const ramp = (durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0) * 300;
  return Math.max(MIN_GRAVITY_MS, Math.round(base - ramp));
}

// ---------------------------------------------------------------------------
// Piece generation

function drawSpec(rng: Rng, bag: Shape[]): [Rng, Shape[], PieceSpec] {
  let r = rng;
  let b = bag;
  if (b.length === 0) [r, b] = rngShuffle(r, SHAPES);
  else b = b.slice();
  const shape = b.pop() as Shape;
  let ki: number;
  [r, ki] = rngInt(r, KIND_POOL.length);
  return [r, b, { shape, kind: KIND_POOL[ki] as Kind }];
}

function emptyGrid(cols: number, rows: number): Cell[][] {
  const g: Cell[][] = [];
  for (let r = 0; r < rows; r++) g.push(new Array<Cell>(cols).fill(null));
  return g;
}

/** Places `spec` as the active piece at spawn. Sets over/topOut if it collides. */
function spawnPiece(s: State, spec: PieceSpec): State {
  const x = spawnX(s, spec.shape);
  const piece: Piece = { shape: spec.shape, kind: spec.kind, rot: 0, x, y: 0 };
  const ok = fits(s, piece.shape, 0, x, 0);
  return {
    ...s,
    active: piece,
    pieceSeq: s.pieceSeq + 1,
    gravityAccMs: 0,
    lockMs: 0,
    lockResets: 0,
    over: ok ? s.over : true,
    topOut: ok ? s.topOut : true,
  };
}

/** Pulls the head of the next queue (refilling it) and spawns it. */
function spawnNext(s: State): State {
  const next = s.next.slice();
  const spec = next.shift() as PieceSpec;
  let rng = s.rng;
  let bag = s.bag;
  let fresh: PieceSpec;
  [rng, bag, fresh] = drawSpec(rng, bag);
  next.push(fresh);
  return spawnPiece({ ...s, rng, bag, next }, spec);
}

// ---------------------------------------------------------------------------
// Init

export function init(seed: number, config: PuzzleConfig = {}): State {
  const difficulty = clamp01(config.difficulty ?? 0.4);
  const durationMs = Math.max(1000, Math.floor(config.durationMs ?? DEFAULT_DURATION_MS));
  let rng = rngFromSeed(seed);
  let bag: Shape[] = [];
  const next: PieceSpec[] = [];
  for (let i = 0; i < NEXT_COUNT + 1; i++) {
    let spec: PieceSpec;
    [rng, bag, spec] = drawSpec(rng, bag);
    next.push(spec);
  }
  const first = next.shift() as PieceSpec;
  const base: State = {
    rng,
    elapsedMs: 0,
    over: false,
    cols: COLS,
    rows: ROWS,
    spawnRows: SPAWN_ROWS,
    grid: emptyGrid(COLS, ROWS),
    active: null,
    next,
    bag,
    hold: null,
    holdUsed: false,
    pieceSeq: 0,
    lockSeq: 0,
    points: 0,
    cannonsLoaded: 0,
    lastClears: 0,
    lastClearRows: [],
    clearSeq: 0,
    lastPrimed: false,
    totalRows: 0,
    primedRows: 0,
    gravityAccMs: 0,
    lockMs: 0,
    lockResets: 0,
    garbageTimerMs: 0,
    garbageSeq: 0,
    stepAccMs: 0,
    perfTimerMs: 0,
    perfPts: 0,
    perf: 0,
    difficulty,
    durationMs,
    topOut: false,
  };
  return spawnPiece(base, first);
}

// ---------------------------------------------------------------------------
// Locking / clearing

function lockPiece(s: State): State {
  const p = s.active as Piece;
  const grid = s.grid.slice();
  const touched = new Set<number>();
  for (const c of pieceCells(p)) {
    if (c.y < 0 || c.y >= s.rows || c.x < 0 || c.x >= s.cols) continue;
    if (!touched.has(c.y)) {
      grid[c.y] = (grid[c.y] as Cell[]).slice();
      touched.add(c.y);
    }
    (grid[c.y] as Cell[])[c.x] = p.kind;
  }
  // Find full rows.
  const full: number[] = [];
  let allPrimed = true;
  for (let r = 0; r < s.rows; r++) {
    const row = grid[r] as Cell[];
    let isFull = true;
    for (let c = 0; c < s.cols; c++) if (row[c] === null) { isFull = false; break; }
    if (isFull) {
      full.push(r);
      if (!isPrimedRow(row)) allPrimed = false;
    }
  }
  const n = full.length;
  let out: State = {
    ...s,
    grid,
    active: null,
    holdUsed: false,
    lockSeq: s.lockSeq + 1,
    lastClears: n,
    lastClearRows: full,
    lastPrimed: n > 0 && allPrimed,
  };
  if (n > 0) {
    const kept = grid.filter((_, r) => !full.includes(r));
    const fresh = emptyGrid(s.cols, n);
    const pts = clearPoints(n, allPrimed);
    let primedRows = s.primedRows;
    for (const r of full) if (isPrimedRow(grid[r] as Cell[])) primedRows++;
    out = {
      ...out,
      grid: fresh.concat(kept),
      points: s.points + pts,
      perfPts: s.perfPts + pts,
      cannonsLoaded: Math.min(MAX_CANNONS, s.cannonsLoaded + n),
      clearSeq: s.clearSeq + 1,
      totalRows: s.totalRows + n,
      primedRows,
    };
  }
  return spawnNext(out);
}

function riseGarbage(s: State): State {
  // Anything in the top row would be shoved off the deck: top-out.
  const top = s.grid[0] as Cell[];
  for (let c = 0; c < s.cols; c++) if (top[c] !== null) return { ...s, over: true, topOut: true };
  let rng = s.rng;
  let gap: number;
  [rng, gap] = rngInt(rng, s.cols);
  const damp: Cell[] = new Array<Cell>(s.cols).fill('damp');
  damp[gap] = null;
  const grid = s.grid.slice(1);
  grid.push(damp);
  let out: State = { ...s, rng, grid, garbageSeq: s.garbageSeq + 1 };
  const p = s.active;
  if (p) {
    let placed = false;
    for (const ny of [p.y - 1, p.y - 2, p.y]) {
      if (ny >= 0 && fits(out, p.shape, p.rot, p.x, ny)) {
        out = { ...out, active: { ...p, y: ny } };
        placed = true;
        break;
      }
    }
    if (!placed) out = { ...out, over: true, topOut: true };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reduce

function tryShift(s: State, dx: number): State {
  const p = s.active;
  if (!p) return s;
  if (!fits(s, p.shape, p.rot, p.x + dx, p.y)) return s;
  return afterSuccessfulMove({ ...s, active: { ...p, x: p.x + dx } });
}

function tryRotate(s: State, dir: 1 | -1): State {
  const p = s.active;
  if (!p) return s;
  const rot = (p.rot + dir + 4) & 3;
  for (const k of KICKS) {
    if (fits(s, p.shape, rot, p.x + k, p.y)) {
      return afterSuccessfulMove({ ...s, active: { ...p, rot, x: p.x + k } });
    }
  }
  return s;
}

/** Lock-delay reset after a successful move/rotate while grounded (max N resets). */
function afterSuccessfulMove(s: State): State {
  if (s.lockMs > 0 && s.lockResets < MAX_LOCK_RESETS) {
    return { ...s, lockMs: 0, lockResets: s.lockResets + 1 };
  }
  return s;
}

function softDrop(s: State): State {
  const p = s.active;
  if (!p) return s;
  if (!fits(s, p.shape, p.rot, p.x, p.y + 1)) return s;
  return { ...s, active: { ...p, y: p.y + 1 }, gravityAccMs: 0, lockMs: 0 };
}

function hardDrop(s: State): State {
  const p = s.active;
  if (!p) return s;
  const y = ghostY(s);
  return lockPiece({ ...s, active: { ...p, y } });
}

function holdPiece(s: State): State {
  const p = s.active;
  if (!p || s.holdUsed) return s;
  const spec: PieceSpec = { shape: p.shape, kind: p.kind };
  if (s.hold) {
    const held = s.hold;
    return spawnPiece({ ...s, hold: spec, holdUsed: true }, held);
  }
  return spawnNext({ ...s, hold: spec, holdUsed: true });
}

export function reduce(s: State, a: Action): State {
  if (s.over || !s.active) return s;
  switch (a.type) {
    case 'left': return tryShift(s, -1);
    case 'right': return tryShift(s, 1);
    case 'rotateCW': return tryRotate(s, 1);
    case 'rotateCCW': return tryRotate(s, -1);
    case 'softDrop': return softDrop(s);
    case 'hardDrop': return hardDrop(s);
    case 'hold': return holdPiece(s);
    default: return s;
  }
}

// ---------------------------------------------------------------------------
// Tick

const PERF_SAMPLE_MS = 1000;
const PERF_ALPHA = 2 / 16; // ~15s window

function step(s: State): State {
  let st: State = { ...s, elapsedMs: s.elapsedMs + STEP_MS };

  // Performance sampling.
  st.perfTimerMs += STEP_MS;
  if (st.perfTimerMs >= PERF_SAMPLE_MS) {
    st.perfTimerMs -= PERF_SAMPLE_MS;
    const pps = st.perfPts / (PERF_SAMPLE_MS / 1000);
    const sample = Math.min(1.5, pps / PERF_PPS_FULL);
    st.perf = ema(st.perf, sample, PERF_ALPHA);
    st.perfPts = 0;
  }

  // Gravity + lock delay.
  const p = st.active;
  if (p) {
    const g = gravityMs(st.difficulty, st.elapsedMs, st.durationMs);
    if (fits(st, p.shape, p.rot, p.x, p.y + 1)) {
      st.gravityAccMs += STEP_MS;
      st.lockMs = 0;
      if (st.gravityAccMs >= g) {
        st.gravityAccMs -= g;
        st.active = { ...p, y: p.y + 1 };
      }
    } else {
      st.gravityAccMs = 0;
      st.lockMs += STEP_MS;
      if (st.lockMs >= LOCK_DELAY_MS) {
        st = lockPiece(st);
        if (st.over) return st;
      }
    }
  }

  // Damp garbage.
  st.garbageTimerMs += STEP_MS;
  if (st.garbageTimerMs >= GARBAGE_INTERVAL_MS) {
    st.garbageTimerMs -= GARBAGE_INTERVAL_MS;
    if (st.difficulty >= GARBAGE_MIN_DIFFICULTY) {
      st = riseGarbage(st);
      if (st.over) return st;
    }
  }

  if (st.elapsedMs >= st.durationMs) st.over = true;
  return st;
}

export function tick(s: State, dtMs: number): State {
  if (s.over) return s;
  const dt = Math.floor(dtMs);
  if (!(dt > 0)) return s;
  let budget = s.stepAccMs + dt;
  let st = s;
  while (budget >= STEP_MS) {
    budget -= STEP_MS;
    st = step(st);
    if (st.over) {
      // Discard the remainder so split and merged ticks agree once the game ends.
      budget = 0;
      break;
    }
  }
  if (st === s) return { ...s, stepAccMs: budget };
  st.stepAccMs = budget;
  return st;
}

// ---------------------------------------------------------------------------
// Score

export function isOver(s: State): boolean {
  return s.over;
}

export function score(s: State): PuzzleScore {
  const visible = Math.max(1, s.rows - s.spawnRows);
  const h = Math.min(visible, stackHeight(s));
  const bonus = 0.1 * (1 - h / visible) * Math.min(1, s.perf * 5);
  const performance = clamp01(s.perf + bonus);
  return { points: s.points, performance, label: ratingLabel(performance) };
}

export const def: PuzzleDef<State, Action> = {
  id: 'gunnery',
  name: 'Gunnery',
  blurb: 'Pack powder, wadding and shot into the gun deck. Complete a row to load a cannon.',
  init,
  reduce,
  tick,
  isOver,
  score,
};
