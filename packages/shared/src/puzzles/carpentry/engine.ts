/**
 * Carpentry — polyomino hull patching.
 *
 * The hull is a 10×10 grid of cells. Holes (connected blobs) are carved into
 * it; the player fits polyomino planks from a 3-slot tray into the holes.
 * Filling a hole scores it (×1.5 "perfect" bonus when it was filled exactly
 * and no discard was used while it was open), the patch becomes solid hull
 * and a new hole is carved. A hole whose remainder no piece could ever fit
 * (a lone cell, say) closes at once as a rough patch — no bonus.
 * Every 25s the sea adds pressure: a small new hole (or, when 5 holes are
 * already open, an existing hole widens). Too many open cells = breach.
 *
 * Pure + deterministic: every random draw threads `state.rng`.
 */
import type { BasePuzzleState, PuzzleConfig, PuzzleDef, PuzzleScore } from '../types';
import { clamp01, ratingLabel } from '../types';
import type { Rng } from '../../rng';
import { rngFromSeed, rngInt, rngNext } from '../../rng';

export const COLS = 10;
export const ROWS = 10;
/** Open (unfilled) hole cells above this count sink the ship. */
export const BREACH_CELLS = 45;
/** Interval between sea-pressure events. */
export const SEA_INTERVAL_MS = 25000;
/** Points lost per discard. */
export const DISCARD_COST = 2;
/** Fixed internal step so split/merged ticks produce identical state. */
const STEP_MS = 100;
/** Performance time constant (ms) — EMA of points per second. */
const RATE_TAU_MS = 20000;
/** Points per second that counts as perfect play. */
const TARGET_PPS = 2;
/** How much open hole cells drag performance down (× open/BREACH_CELLS). */
const HOLE_PENALTY = 0.4;
const RATE_DECAY = 1 - STEP_MS / RATE_TAU_MS;
const ACTIVE_HOLES = 3;
const MAX_HOLES = 5;
const REFILL_ATTEMPTS = 20;

export type CellKind = 'solid' | 'hole' | 'filled';

export interface Pt {
  x: number;
  y: number;
}

export interface Hole {
  id: number;
  /** Every cell belonging to this hole (filled or not). */
  cells: Pt[];
  /** Number of cells already patched. */
  filled: number;
  /** False once a discard happens while this hole is open. */
  perfect: boolean;
  /** elapsedMs when the hole appeared. */
  bornAt: number;
}

export interface Piece {
  /** Library key, e.g. 'T4'. */
  kind: string;
  /** Normalised to origin (min x = min y = 0), sorted by y then x. */
  shape: Pt[];
}

export interface State extends BasePuzzleState {
  cols: number;
  rows: number;
  /** Row-major, length cols*rows. */
  cells: CellKind[];
  /** Hole id owning each cell, -1 for plain hull. */
  owner: number[];
  holes: Hole[];
  nextHoleId: number;
  tray: Piece[];
  points: number;
  completedHoles: number;
  /** Increments on every completed hole (renderer keys flashes off it). */
  clearSeq: number;
  lastCompleted: Pt[];
  lastCompletedPerfect: boolean;
  lastCompletedAt: number;
  /** Increments on every placement (renderer keys pop animations off it). */
  placeSeq: number;
  lastPlaced: Pt[];
  discards: number;
  /** Holes closed imperfectly because their remainder could never be tiled. */
  roughPatches: number;
  /** Increments on every sea-pressure event. */
  seaSeq: number;
  lastSea: Pt[];
  seaMs: number;
  stepAccMs: number;
  breached: boolean;
  /** Leaky-integrated points per second (the performance EMA). */
  rate: number;
  durationMs: number;
  difficulty: number;
}

export type Action =
  | { type: 'rotate'; slot: number }
  | { type: 'flip'; slot: number }
  | { type: 'place'; slot: number; x: number; y: number }
  | { type: 'discard'; slot: number };

// ---------------------------------------------------------------- pieces

function pts(list: [number, number][]): Pt[] {
  return list.map(([x, y]) => ({ x, y }));
}

/** Domino, two trominoes, the seven tetrominoes and nine pentominoes. */
export const PIECE_LIBRARY: Readonly<Record<string, Pt[]>> = {
  I2: pts([[0, 0], [1, 0]]),
  I3: pts([[0, 0], [1, 0], [2, 0]]),
  L3: pts([[0, 0], [0, 1], [1, 1]]),
  I4: pts([[0, 0], [1, 0], [2, 0], [3, 0]]),
  O4: pts([[0, 0], [1, 0], [0, 1], [1, 1]]),
  T4: pts([[0, 0], [1, 0], [2, 0], [1, 1]]),
  S4: pts([[1, 0], [2, 0], [0, 1], [1, 1]]),
  Z4: pts([[0, 0], [1, 0], [1, 1], [2, 1]]),
  J4: pts([[0, 0], [0, 1], [1, 1], [2, 1]]),
  L4: pts([[2, 0], [0, 1], [1, 1], [2, 1]]),
  P5: pts([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]),
  U5: pts([[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]]),
  L5: pts([[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]]),
  N5: pts([[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]]),
  T5: pts([[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]]),
  W5: pts([[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]]),
  F5: pts([[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]),
  Y5: pts([[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]]),
  V5: pts([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]),
};

/** Every orientation of every library piece (computed once). */
let ALL_ORIENTATIONS_CACHE: Pt[][] | null = null;
function allOrientations(): Pt[][] {
  if (!ALL_ORIENTATIONS_CACHE) {
    const out: Pt[][] = [];
    for (const sh of Object.values(PIECE_LIBRARY)) for (const o of shapeOrientations(sh)) out.push(o);
    ALL_ORIENTATIONS_CACHE = out;
  }
  return ALL_ORIENTATIONS_CACHE;
}

const KINDS_BY_SIZE: Readonly<Record<number, readonly string[]>> = {
  2: ['I2'],
  3: ['I3', 'L3'],
  4: ['I4', 'O4', 'T4', 'S4', 'Z4', 'J4', 'L4'],
  5: ['P5', 'U5', 'L5', 'N5', 'T5', 'W5', 'F5', 'Y5', 'V5'],
};

/** Translates so min x/y are 0 and sorts by (y, x) so equal shapes compare equal. */
export function normaliseShape(shape: readonly Pt[]): Pt[] {
  let mx = Infinity;
  let my = Infinity;
  for (const p of shape) {
    if (p.x < mx) mx = p.x;
    if (p.y < my) my = p.y;
  }
  const out = shape.map((p) => ({ x: p.x - mx, y: p.y - my }));
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/** 90° clockwise (screen coordinates, y down). */
export function rotateShape(shape: readonly Pt[]): Pt[] {
  return normaliseShape(shape.map((p) => ({ x: -p.y, y: p.x })));
}

/** Horizontal mirror. */
export function flipShape(shape: readonly Pt[]): Pt[] {
  return normaliseShape(shape.map((p) => ({ x: -p.x, y: p.y })));
}

export function sameShape(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

/** Bounding box of a normalised shape (max x / max y). */
export function shapeBounds(shape: readonly Pt[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const p of shape) {
    if (p.x + 1 > w) w = p.x + 1;
    if (p.y + 1 > h) h = p.y + 1;
  }
  return { w, h };
}

/** All distinct orientations (rotations × mirror) of a shape. */
export function shapeOrientations(shape: readonly Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let s = normaliseShape(shape);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      if (!out.some((o) => sameShape(o, s))) out.push(s);
      s = rotateShape(s);
    }
    s = flipShape(s);
  }
  return out;
}

function genPiece(rng: Rng, difficulty: number): [Rng, Piece] {
  const d = clamp01(difficulty);
  const weights: [number, number][] = [
    [2, 1.4 - d],
    [3, 2.4 - d],
    [4, 3 + d],
    [5, 0.8 + 2.6 * d],
  ];
  let total = 0;
  for (const [, w] of weights) total += w;
  let [r, v] = rngNext(rng);
  v *= total;
  let size = 4;
  for (const [sz, w] of weights) {
    if (v < w) {
      size = sz;
      break;
    }
    v -= w;
  }
  const kinds = KINDS_BY_SIZE[size]!;
  let ki: number;
  [r, ki] = rngInt(r, kinds.length);
  const kind = kinds[ki]!;
  let shape = normaliseShape(PIECE_LIBRARY[kind]!);
  let rot: number;
  [r, rot] = rngInt(r, 4);
  for (let i = 0; i < rot; i++) shape = rotateShape(shape);
  let flip: number;
  [r, flip] = rngInt(r, 2);
  if (flip) shape = flipShape(shape);
  return [r, { kind, shape }];
}

// ---------------------------------------------------------------- grid helpers

function idx(x: number, y: number): number {
  return y * COLS + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

const DIRS: readonly Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Number of unfilled hole cells. */
export function openCells(state: State): number {
  let n = 0;
  for (const c of state.cells) if (c === 'hole') n++;
  return n;
}

/**
 * Legal placement: every shape cell lands in bounds on an unfilled hole cell
 * and all of them belong to the same hole. Returns that hole id or -1.
 */
export function placementHole(cells: readonly CellKind[], owner: readonly number[], shape: readonly Pt[], ox: number, oy: number): number {
  let hid = -1;
  for (const p of shape) {
    const x = ox + p.x;
    const y = oy + p.y;
    if (!inBounds(x, y)) return -1;
    const i = idx(x, y);
    if (cells[i] !== 'hole') return -1;
    const o = owner[i]!;
    if (hid === -1) hid = o;
    else if (o !== hid) return -1;
  }
  return hid;
}

export function canPlace(state: State, slot: number, x: number, y: number): boolean {
  const piece = state.tray[slot];
  if (!piece) return false;
  return placementHole(state.cells, state.owner, piece.shape, x, y) !== -1;
}

/** True when any tray piece, in any orientation, fits anywhere. */
export function anyPieceFits(cells: readonly CellKind[], owner: readonly number[], tray: readonly Piece[]): boolean {
  for (const piece of tray) {
    for (const shape of shapeOrientations(piece.shape)) {
      const b = shapeBounds(shape);
      for (let y = 0; y + b.h <= ROWS; y++) {
        for (let x = 0; x + b.w <= COLS; x++) {
          if (placementHole(cells, owner, shape, x, y) !== -1) return true;
        }
      }
    }
  }
  return false;
}

/**
 * A hole is stuck when no library piece, in any orientation, fits into its
 * remaining open cells (e.g. a lone cell is left). Such a hole can never be
 * finished exactly, so it closes as a rough (imperfect) patch.
 */
export function holeStuck(cells: readonly CellKind[], owner: readonly number[], hole: Hole): boolean {
  let minX = COLS;
  let minY = ROWS;
  let maxX = -1;
  let maxY = -1;
  for (const p of hole.cells) {
    if (cells[idx(p.x, p.y)] !== 'hole') continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX < 0) return false; // nothing open
  for (const shape of allOrientations()) {
    const b = shapeBounds(shape);
    for (let y = minY; y + b.h - 1 <= maxY; y++) {
      for (let x = minX; x + b.w - 1 <= maxX; x++) {
        if (placementHole(cells, owner, shape, x, y) === hole.id) return false;
      }
    }
  }
  return true;
}

/** Cells that are hull and not edge-adjacent to any hole cell (filled or not). */
function freeMask(cells: readonly CellKind[]): boolean[] {
  const free: boolean[] = new Array(COLS * ROWS).fill(false);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = idx(x, y);
      if (cells[i] !== 'solid') continue;
      let ok = true;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (inBounds(nx, ny) && cells[idx(nx, ny)] !== 'solid') {
          ok = false;
          break;
        }
      }
      free[i] = ok;
    }
  }
  return free;
}

/**
 * Grows a random connected blob of `minN..maxN` cells inside `free`.
 * Returns null when no blob of at least `minN` cells can be grown.
 */
function growBlob(rng: Rng, free: readonly boolean[], minN: number, maxN: number): [Rng, Pt[] | null] {
  let r = rng;
  const starts: number[] = [];
  for (let i = 0; i < free.length; i++) if (free[i]) starts.push(i);
  if (starts.length < minN) return [r, null];
  let n: number;
  [r, n] = rngInt(r, maxN - minN + 1);
  n += minN;
  for (let attempt = 0; attempt < 12 && starts.length > 0; attempt++) {
    let si: number;
    [r, si] = rngInt(r, starts.length);
    const start = starts[si]!;
    const inBlob: boolean[] = new Array(free.length).fill(false);
    const blob: number[] = [start];
    inBlob[start] = true;
    const frontier: number[] = [];
    const inFrontier: boolean[] = new Array(free.length).fill(false);
    const expand = (i: number): void => {
      const x = i % COLS;
      const y = (i - x) / COLS;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (free[j] && !inBlob[j] && !inFrontier[j]) {
          inFrontier[j] = true;
          frontier.push(j);
        }
      }
    };
    expand(start);
    while (blob.length < n && frontier.length > 0) {
      let fi: number;
      [r, fi] = rngInt(r, frontier.length);
      const c = frontier[fi]!;
      frontier[fi] = frontier[frontier.length - 1]!;
      frontier.pop();
      inFrontier[c] = false;
      inBlob[c] = true;
      blob.push(c);
      expand(c);
    }
    if (blob.length >= minN) {
      const out = blob.map((i) => ({ x: i % COLS, y: Math.floor(i / COLS) }));
      out.sort((a, b) => a.y - b.y || a.x - b.x);
      return [r, out];
    }
    // this start is boxed in; drop it and try another
    starts.splice(si, 1);
  }
  return [r, null];
}

/** Carves a new hole into copies of cells/owner. Returns null when there is no room. */
function carveHole(state: State, rng: Rng, minN: number, maxN: number): [Rng, State] {
  const free = freeMask(state.cells);
  const [r, blob] = growBlob(rng, free, minN, maxN);
  if (!blob) return [r, state];
  const cells = state.cells.slice();
  const owner = state.owner.slice();
  const id = state.nextHoleId;
  for (const p of blob) {
    cells[idx(p.x, p.y)] = 'hole';
    owner[idx(p.x, p.y)] = id;
  }
  const hole: Hole = { id, cells: blob, filled: 0, perfect: true, bornAt: state.elapsedMs };
  return [r, { ...state, rng: r, cells, owner, holes: [...state.holes, hole], nextHoleId: id + 1 }];
}

/** Widens a hole by up to `k` solid cells adjacent to it but not to any other hole. */
function widenHole(state: State, rng: Rng, holeIdx: number, k: number): [Rng, State, Pt[]] {
  const hole = state.holes[holeIdx];
  if (!hole) return [rng, state, []];
  let r = rng;
  const cells = state.cells.slice();
  const owner = state.owner.slice();
  const added: Pt[] = [];
  const newCells = hole.cells.slice();
  for (let step = 0; step < k; step++) {
    const cands: number[] = [];
    const seen: boolean[] = new Array(COLS * ROWS).fill(false);
    for (const p of newCells) {
      for (const d of DIRS) {
        const x = p.x + d.x;
        const y = p.y + d.y;
        if (!inBounds(x, y)) continue;
        const i = idx(x, y);
        if (seen[i] || cells[i] !== 'solid') continue;
        seen[i] = true;
        let ok = true;
        for (const d2 of DIRS) {
          const nx = x + d2.x;
          const ny = y + d2.y;
          if (!inBounds(nx, ny)) continue;
          const j = idx(nx, ny);
          if (cells[j] !== 'solid' && owner[j] !== hole.id) {
            ok = false;
            break;
          }
        }
        if (ok) cands.push(i);
      }
    }
    if (cands.length === 0) break;
    let ci: number;
    [r, ci] = rngInt(r, cands.length);
    const c = cands[ci]!;
    const p = { x: c % COLS, y: Math.floor(c / COLS) };
    cells[c] = 'hole';
    owner[c] = hole.id;
    newCells.push(p);
    added.push(p);
  }
  if (added.length === 0) return [r, state, []];
  newCells.sort((a, b) => a.y - b.y || a.x - b.x);
  const holes = state.holes.slice();
  holes[holeIdx] = { ...hole, cells: newCells };
  return [r, { ...state, rng: r, cells, owner, holes }, added];
}

/** Refills `slot`, retrying so that some tray piece fits somewhere when possible. */
function refillSlot(state: State, rng: Rng, slot: number): [Rng, Piece[]] {
  let r = rng;
  let tray = state.tray;
  for (let attempt = 0; attempt < REFILL_ATTEMPTS; attempt++) {
    let piece: Piece;
    [r, piece] = genPiece(r, state.difficulty);
    tray = state.tray.slice();
    tray[slot] = piece;
    if (anyPieceFits(state.cells, state.owner, tray)) break;
  }
  return [r, tray];
}

function checkBreach(state: State): State {
  if (state.over) return state;
  if (openCells(state) > BREACH_CELLS) return { ...state, over: true, breached: true };
  return state;
}

export function holeScore(cells: number, perfect: boolean): number {
  const base = 10 + 2 * cells;
  return perfect ? Math.round(base * 1.5) : base;
}

// ---------------------------------------------------------------- def

function init(seed: number, config?: PuzzleConfig): State {
  const difficulty = clamp01(config?.difficulty ?? 0.4);
  let state: State = {
    rng: rngFromSeed(seed),
    elapsedMs: 0,
    over: false,
    cols: COLS,
    rows: ROWS,
    cells: new Array<CellKind>(COLS * ROWS).fill('solid'),
    owner: new Array<number>(COLS * ROWS).fill(-1),
    holes: [],
    nextHoleId: 1,
    tray: [],
    points: 0,
    completedHoles: 0,
    clearSeq: 0,
    lastCompleted: [],
    lastCompletedPerfect: false,
    lastCompletedAt: -1,
    placeSeq: 0,
    lastPlaced: [],
    discards: 0,
    roughPatches: 0,
    seaSeq: 0,
    lastSea: [],
    seaMs: 0,
    stepAccMs: 0,
    breached: false,
    rate: 0,
    durationMs: Math.max(1000, Math.floor(config?.durationMs ?? 150000)),
    difficulty,
  };
  let rng = state.rng;
  for (let i = 0; i < ACTIVE_HOLES; i++) [rng, state] = carveHole(state, rng, 5, 9);
  for (let slot = 0; slot < 3; slot++) {
    let tray: Piece[];
    [rng, tray] = refillSlot(state, rng, slot);
    state = { ...state, tray };
  }
  return { ...state, rng };
}

function validSlot(state: State, slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < state.tray.length;
}

function reduce(state: State, action: Action): State {
  if (state.over) return state;
  switch (action.type) {
    case 'rotate':
    case 'flip': {
      if (!validSlot(state, action.slot)) return state;
      const piece = state.tray[action.slot]!;
      const shape = action.type === 'rotate' ? rotateShape(piece.shape) : flipShape(piece.shape);
      if (sameShape(shape, piece.shape)) return state;
      const tray = state.tray.slice();
      tray[action.slot] = { kind: piece.kind, shape };
      return { ...state, tray };
    }
    case 'discard': {
      if (!validSlot(state, action.slot)) return state;
      const holes = state.holes.map((h) => (h.perfect ? { ...h, perfect: false } : h));
      const [rng, tray] = refillSlot(state, state.rng, action.slot);
      return {
        ...state,
        rng,
        tray,
        holes,
        points: Math.max(0, state.points - DISCARD_COST),
        discards: state.discards + 1,
      };
    }
    case 'place': {
      if (!validSlot(state, action.slot)) return state;
      if (!Number.isInteger(action.x) || !Number.isInteger(action.y)) return state;
      const piece = state.tray[action.slot]!;
      const hid = placementHole(state.cells, state.owner, piece.shape, action.x, action.y);
      if (hid === -1) return state;
      const cells = state.cells.slice();
      const placed: Pt[] = [];
      for (const p of piece.shape) {
        const x = action.x + p.x;
        const y = action.y + p.y;
        cells[idx(x, y)] = 'filled';
        placed.push({ x, y });
      }
      const hi = state.holes.findIndex((h) => h.id === hid);
      const hole = state.holes[hi]!;
      const filled = hole.filled + piece.shape.length;
      let next: State = {
        ...state,
        cells,
        placeSeq: state.placeSeq + 1,
        lastPlaced: placed,
      };
      let rng = state.rng;
      const exact = filled >= hole.cells.length;
      const stuck = !exact && holeStuck(cells, next.owner, hole);
      if (exact || stuck) {
        // Hole complete (exactly, or closed as a rough patch because nothing
        // can ever fit the remainder): score it, turn it to hull, carve a replacement.
        const perfect = exact && hole.perfect;
        const owner = next.owner.slice();
        for (const p of hole.cells) {
          cells[idx(p.x, p.y)] = 'solid';
          owner[idx(p.x, p.y)] = -1;
        }
        const gained = holeScore(hole.cells.length, perfect);
        const holes = state.holes.filter((h) => h.id !== hid);
        next = {
          ...next,
          cells,
          owner,
          holes,
          points: state.points + gained,
          completedHoles: state.completedHoles + 1,
          clearSeq: state.clearSeq + 1,
          lastCompleted: hole.cells,
          lastCompletedPerfect: perfect,
          roughPatches: state.roughPatches + (exact ? 0 : 1),
          lastCompletedAt: state.elapsedMs,
          rate: state.rate + (gained * 1000) / RATE_TAU_MS,
        };
        while (next.holes.length < ACTIVE_HOLES) {
          const before = next.holes.length;
          [rng, next] = carveHole(next, rng, 5, 9);
          if (next.holes.length === before) break; // no room
        }
      } else {
        const holes = state.holes.slice();
        holes[hi] = { ...hole, filled };
        next = { ...next, holes };
      }
      let tray: Piece[];
      [rng, tray] = refillSlot(next, rng, action.slot);
      return checkBreach({ ...next, rng, tray });
    }
    default:
      return state;
  }
}

function seaEvent(state: State): State {
  let rng = state.rng;
  let next = state;
  let added: Pt[] = [];
  if (state.holes.length < MAX_HOLES) {
    const before = state.holes.length;
    [rng, next] = carveHole(state, rng, 3, 5);
    if (next.holes.length > before) added = next.holes[next.holes.length - 1]!.cells;
  }
  if (added.length === 0 && next.holes.length > 0) {
    let hi: number;
    [rng, hi] = rngInt(rng, next.holes.length);
    let k: number;
    [rng, k] = rngInt(rng, 2);
    // try each hole, starting from a random one, until one has room to widen
    for (let i = 0; i < next.holes.length && added.length === 0; i++) {
      [rng, next, added] = widenHole(next, rng, (hi + i) % next.holes.length, 2 + k);
    }
  }
  return checkBreach({ ...next, rng, seaSeq: state.seaSeq + 1, lastSea: added });
}

function step(state: State): State {
  let next: State = { ...state, rate: state.rate * RATE_DECAY, seaMs: state.seaMs + STEP_MS };
  if (next.seaMs >= SEA_INTERVAL_MS) {
    next = seaEvent({ ...next, seaMs: next.seaMs - SEA_INTERVAL_MS });
  }
  return next;
}

function tick(state: State, dtMs: number): State {
  if (state.over) return state;
  const dt = Math.max(0, Math.floor(dtMs));
  if (dt === 0) return state;
  // Time already consumed by whole steps; elapsedMs during stepping is derived
  // from it so events (hole bornAt) see the same clock however ticks are split.
  const stepped = state.elapsedMs - state.stepAccMs;
  let acc = state.stepAccMs + dt;
  let next: State = state;
  let n = 0;
  while (acc >= STEP_MS && !next.over) {
    acc -= STEP_MS;
    n++;
    next = step({ ...next, elapsedMs: stepped + n * STEP_MS, stepAccMs: acc });
  }
  next = { ...next, elapsedMs: state.elapsedMs + dt, stepAccMs: acc };
  if (!next.over && next.elapsedMs >= next.durationMs) next = { ...next, over: true };
  return next;
}

function isOver(state: State): boolean {
  return state.over;
}

export function performanceOf(state: State): number {
  const raw = state.rate / TARGET_PPS;
  const penalty = (HOLE_PENALTY * openCells(state)) / BREACH_CELLS;
  return clamp01(raw - penalty);
}

function score(state: State): PuzzleScore {
  const performance = performanceOf(state);
  return { points: state.points, performance, label: ratingLabel(performance) };
}

export const def: PuzzleDef<State, Action> = {
  id: 'carpentry',
  name: 'Carpentry',
  blurb: 'Fit planks into the holes in the hull. Fill a hole exactly for a perfect patch.',
  init,
  reduce,
  tick,
  isOver,
  score,
};
