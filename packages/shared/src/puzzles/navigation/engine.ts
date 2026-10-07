/**
 * Navigation — star-chart course rotation.
 *
 * A 7x7 chart of tiles, each a short run of "course" with 2–4 openings
 * (N/E/S/W bit mask). The helm sits below column 3 and feeds the bottom
 * tile from the south. Stars sit above the top row; a star is reached when
 * the top tile in its column is connected to the helm and opens north.
 *
 * Rotating tiles is the only action. After every rotation the connected
 * ("lit") set is recomputed; if a star is reached the course scores, all lit
 * tiles are replaced with fresh ones and the stars re-roll. Fog rises while
 * you dither and the chart is lost at 100%.
 *
 * Pure & deterministic: all randomness comes from `state.rng`.
 */
import { rngFromSeed, rngInt, rngNext, type Rng } from '../../rng';
import { clamp01, ema, ratingLabel, type BasePuzzleState, type PuzzleConfig, type PuzzleDef, type PuzzleScore } from '../types';

export const NAV_W = 7;
export const NAV_H = 7;
/** Column of the helm (source), feeding tile (HELM_X, NAV_H - 1) from the south. */
export const HELM_X = 3;

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export const MAX_LOCKED = 3;
export const FOG_CLEAR_PER_COURSE = 0.35;
export const STAR_POINTS = 4;
/** Points-per-second that maps to performance 1.0. */
export const TARGET_PPS = 2.5;
const PERF_ALPHA = 0.05; // per 1s sample => ~20s window
const PERF_CAP = 1.5;
const FOG_PERF_PENALTY = 0.3;
const MAX_REROLL = 200;

export interface Tile {
  /** Connector bitmask: N=1, E=2, S=4, W=8. */
  mask: number;
  /** Reef: cannot be rotated. */
  locked: boolean;
}

export interface Course {
  /** [x, y] pairs of every tile that was lit when the course completed. */
  cells: [number, number][];
  /** Column of the star that was reached. */
  star: number;
  /** Value of the star (1..3). */
  starValue: number;
  /** Points awarded for the course. */
  points: number;
}

export interface State extends BasePuzzleState {
  w: number;
  h: number;
  difficulty: number;
  durationMs: number;
  /** tiles[y][x] */
  tiles: Tile[][];
  /** Star columns (2–3, distinct, sorted). */
  stars: number[];
  /** Value of each star (parallel to `stars`), 1..3. */
  starValues: number[];
  /** lit[y][x]: connected to the helm through reciprocal openings. */
  lit: boolean[][];
  /** 0..1 fog meter. Derived from fogMs / fogFillMs. */
  fog: number;
  /** Integer ms of fog accumulated (so split ticks are exact). */
  fogMs: number;
  /** ms for fog to fill from empty when idle. */
  fogFillMs: number;
  points: number;
  courseSeq: number;
  lastCourse: Course | null;
  /** Number of rotations performed. */
  moves: number;
  /** Raw EMA of (pts/s) / TARGET_PPS, before fog penalty & clamp. */
  perf: number;
  /** Points scored since the last 1s performance sample. */
  windowPts: number;
  /** Integer ms since the last performance sample (0..999). */
  perfAccMs: number;
}

export type Action = { type: 'rotate'; x: number; y: number; dir: 1 | -1 };

// ---------------------------------------------------------------------------
// Mask helpers

export function rotateMask(mask: number, dir: 1 | -1): number {
  return dir === 1 ? ((mask << 1) | (mask >> 3)) & 15 : ((mask >> 1) | (mask << 3)) & 15;
}

export function openingCount(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

const DIRS: readonly { bit: number; dx: number; dy: number; opp: number }[] = [
  { bit: N, dx: 0, dy: -1, opp: S },
  { bit: E, dx: 1, dy: 0, opp: W },
  { bit: S, dx: 0, dy: 1, opp: N },
  { bit: W, dx: -1, dy: 0, opp: E },
];

/** Base shapes before rotation. */
const SHAPE_STRAIGHT = N | S;
const SHAPE_CORNER = N | E;
const SHAPE_TEE = N | E | S;
const SHAPE_CROSS = N | E | S | W;

/** Draws one random tile mask according to difficulty. */
function randomMask(rng: Rng, difficulty: number): [Rng, number] {
  const d = clamp01(difficulty);
  const wStraight = Math.max(0.08, 0.45 - 0.3 * d);
  const wCorner = 0.35 + 0.1 * d;
  const wTee = 0.2 + 0.15 * d;
  const wCross = d > 0.6 ? (d - 0.6) * 0.15 : 0;
  const total = wStraight + wCorner + wTee + wCross;
  let r: number;
  [rng, r] = rngNext(rng);
  r *= total;
  let base: number;
  if (r < wStraight) base = SHAPE_STRAIGHT;
  else if (r < wStraight + wCorner) base = SHAPE_CORNER;
  else if (r < wStraight + wCorner + wTee) base = SHAPE_TEE;
  else base = SHAPE_CROSS;
  let turns: number;
  [rng, turns] = rngInt(rng, 4);
  let mask = base;
  for (let i = 0; i < turns; i++) mask = rotateMask(mask, 1);
  return [rng, mask];
}

// ---------------------------------------------------------------------------
// Connectivity

/** Computes the set of tiles connected to the helm through reciprocal openings. */
export function computeLit(tiles: readonly (readonly Tile[])[], w: number, h: number): boolean[][] {
  const lit: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) row.push(false);
    lit.push(row);
  }
  const startTile = tiles[h - 1]?.[HELM_X];
  if (!startTile || !(startTile.mask & S)) return lit;
  const stack: number[] = [HELM_X, h - 1];
  lit[h - 1]![HELM_X] = true;
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const mask = tiles[y]![x]!.mask;
    for (const d of DIRS) {
      if (!(mask & d.bit)) continue;
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (lit[ny]![nx]) continue;
      if (!(tiles[ny]![nx]!.mask & d.opp)) continue;
      lit[ny]![nx] = true;
      stack.push(nx, ny);
    }
  }
  return lit;
}

/** Index into `stars` of the best reached star, or -1. Ties go to the leftmost. */
export function reachedStar(state: Pick<State, 'tiles' | 'stars' | 'starValues'>, lit: readonly (readonly boolean[])[]): number {
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < state.stars.length; i++) {
    const c = state.stars[i]!;
    const top = state.tiles[0]![c]!;
    if (lit[0]![c] && (top.mask & N)) {
      const v = state.starValues[i]!;
      if (v > bestValue) {
        best = i;
        bestValue = v;
      }
    }
  }
  return best;
}

function countLit(lit: readonly (readonly boolean[])[]): number {
  let n = 0;
  for (const row of lit) for (const v of row) if (v) n++;
  return n;
}

function litCells(lit: readonly (readonly boolean[])[]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < lit.length; y++) {
    const row = lit[y]!;
    for (let x = 0; x < row.length; x++) if (row[x]) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation

function rollStars(rng: Rng): [Rng, number[], number[]] {
  let n: number;
  [rng, n] = rngInt(rng, 2); // 0 or 1
  n += 2; // 2..3
  const cols: number[] = [];
  while (cols.length < n) {
    let c: number;
    [rng, c] = rngInt(rng, NAV_W);
    if (!cols.includes(c)) cols.push(c);
  }
  cols.sort((a, b) => a - b);
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    let v: number;
    [rng, v] = rngInt(rng, 3);
    values.push(v + 1);
  }
  return [rng, cols, values];
}

/**
 * Re-rolls tiles (never locked ones) until no star is reached. Mutates
 * `tiles` in place (caller passes a fresh copy). Returns the rng and lit set.
 */
function ensureUnsolved(rng: Rng, tiles: Tile[][], stars: number[], starValues: number[], difficulty: number): [Rng, boolean[][]] {
  let lit = computeLit(tiles, NAV_W, NAV_H);
  for (let iter = 0; iter < MAX_REROLL; iter++) {
    const idx = reachedStar({ tiles, stars, starValues }, lit);
    if (idx < 0) break;
    const col = stars[idx]!;
    let tx = col;
    let ty = 0;
    if (tiles[0]![col]!.locked) {
      // Pick a random lit, unlocked tile (the helm tile is never locked, so one exists).
      const candidates = litCells(lit).filter(([x, y]) => !tiles[y]![x]!.locked);
      let k: number;
      [rng, k] = rngInt(rng, candidates.length);
      const cell = candidates[k]!;
      tx = cell[0];
      ty = cell[1];
    }
    let mask: number;
    [rng, mask] = randomMask(rng, difficulty);
    tiles[ty]![tx] = { mask, locked: false };
    lit = computeLit(tiles, NAV_W, NAV_H);
  }
  return [rng, lit];
}

function fogFillForDifficulty(d: number): number {
  // 60s at 0, 45s at 0.4, 22.5s at 1.
  return Math.round(60000 - 37500 * clamp01(d));
}

function init(seed: number, config?: PuzzleConfig): State {
  const difficulty = clamp01(config?.difficulty ?? 0.4);
  const durationMs = Math.max(1000, Math.floor(config?.durationMs ?? 150000));
  let rng: Rng = rngFromSeed(seed);

  const tiles: Tile[][] = [];
  for (let y = 0; y < NAV_H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < NAV_W; x++) {
      let mask: number;
      [rng, mask] = randomMask(rng, difficulty);
      row.push({ mask, locked: false });
    }
    tiles.push(row);
  }

  // Reefs: occasionally at higher difficulty; never on or adjacent to the helm tile.
  if (difficulty > 0.5) {
    const maxLocked = Math.min(MAX_LOCKED, Math.round((difficulty - 0.5) * 6));
    let count: number;
    [rng, count] = rngInt(rng, maxLocked + 1);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 100) {
      let x: number;
      let y: number;
      [rng, x] = rngInt(rng, NAV_W);
      [rng, y] = rngInt(rng, NAV_H);
      const nearHelm = Math.abs(x - HELM_X) + Math.abs(y - (NAV_H - 1)) <= 1;
      if (nearHelm || tiles[y]![x]!.locked) continue;
      tiles[y]![x] = { mask: tiles[y]![x]!.mask, locked: true };
      placed++;
    }
  }

  let stars: number[];
  let starValues: number[];
  [rng, stars, starValues] = rollStars(rng);

  let lit: boolean[][];
  [rng, lit] = ensureUnsolved(rng, tiles, stars, starValues, difficulty);

  return {
    rng,
    elapsedMs: 0,
    over: false,
    w: NAV_W,
    h: NAV_H,
    difficulty,
    durationMs,
    tiles,
    stars,
    starValues,
    lit,
    fog: 0,
    fogMs: 0,
    fogFillMs: fogFillForDifficulty(difficulty),
    points: 0,
    courseSeq: 0,
    lastCourse: null,
    moves: 0,
    perf: 0,
    windowPts: 0,
    perfAccMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Reduce

function reduce(state: State, action: Action): State {
  if (state.over) return state;
  if (!action || action.type !== 'rotate') return state;
  const { x, y, dir } = action;
  if (dir !== 1 && dir !== -1) return state;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return state;
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return state;
  const tile = state.tiles[y]![x]!;
  if (tile.locked) return state;
  const newMask = rotateMask(tile.mask, dir);
  if (newMask === tile.mask) return state; // cross: nothing changed

  const tiles = state.tiles.map((row) => row.slice());
  tiles[y]![x] = { mask: newMask, locked: false };
  let lit = computeLit(tiles, state.w, state.h);
  const idx = reachedStar({ tiles, stars: state.stars, starValues: state.starValues }, lit);

  if (idx < 0) {
    return { ...state, tiles, lit, moves: state.moves + 1 };
  }

  // Course set!
  const starValue = state.starValues[idx]!;
  const cells = litCells(lit);
  const gained = STAR_POINTS * starValue + cells.length;
  let rng = state.rng;
  for (const [cx, cy] of cells) {
    if (tiles[cy]![cx]!.locked) continue; // reefs stay put
    let mask: number;
    [rng, mask] = randomMask(rng, state.difficulty);
    tiles[cy]![cx] = { mask, locked: false };
  }
  let stars: number[];
  let starValues: number[];
  [rng, stars, starValues] = rollStars(rng);
  [rng, lit] = ensureUnsolved(rng, tiles, stars, starValues, state.difficulty);

  const fogMs = Math.max(0, state.fogMs - Math.round(FOG_CLEAR_PER_COURSE * state.fogFillMs));
  return {
    ...state,
    rng,
    tiles,
    lit,
    stars,
    starValues,
    fogMs,
    fog: fogMs / state.fogFillMs,
    points: state.points + gained,
    windowPts: state.windowPts + gained,
    courseSeq: state.courseSeq + 1,
    lastCourse: { cells, star: state.stars[idx]!, starValue, points: gained },
    moves: state.moves + 1,
  };
}

// ---------------------------------------------------------------------------
// Tick

function tick(state: State, dtMs: number): State {
  if (state.over) return state;
  let left = Math.floor(dtMs);
  if (!(left > 0)) return state;

  let elapsedMs = state.elapsedMs;
  let fogMs = state.fogMs;
  let perfAccMs = state.perfAccMs;
  let perf = state.perf;
  let windowPts = state.windowPts;
  let over = false;

  while (left > 0 && !over) {
    // Advance to the next event boundary so results are identical however dt is split.
    let step = left;
    step = Math.min(step, 1000 - perfAccMs);
    step = Math.min(step, state.fogFillMs - fogMs);
    step = Math.min(step, state.durationMs - elapsedMs);
    if (step <= 0) step = 1;
    left -= step;
    elapsedMs += step;
    fogMs += step;
    perfAccMs += step;
    if (perfAccMs >= 1000) {
      perfAccMs -= 1000;
      const sample = windowPts / TARGET_PPS;
      perf = Math.min(PERF_CAP, ema(perf, sample, PERF_ALPHA));
      windowPts = 0;
    }
    if (fogMs >= state.fogFillMs) {
      fogMs = state.fogFillMs;
      over = true;
    }
    if (elapsedMs >= state.durationMs) {
      elapsedMs = state.durationMs;
      over = true;
    }
  }

  return {
    ...state,
    elapsedMs,
    fogMs,
    fog: fogMs / state.fogFillMs,
    perfAccMs,
    perf,
    windowPts,
    over,
  };
}

function isOver(state: State): boolean {
  return state.over;
}

function score(state: State): PuzzleScore {
  const performance = clamp01(state.perf - state.fog * FOG_PERF_PENALTY);
  return { points: state.points, performance, label: ratingLabel(performance) };
}

export const def: PuzzleDef<State, Action> = {
  id: 'navigation',
  name: 'Navigation',
  blurb: 'Rotate the chart tiles to run an unbroken course from the helm to a star. Longer courses are worth more.',
  init,
  reduce,
  tick,
  isOver,
  score,
};
