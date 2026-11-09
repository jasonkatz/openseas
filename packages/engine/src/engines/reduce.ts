import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_ENGINES_CONFIG,
  type Injector,
  type InjectorCell,
  type Rotation,
  type EnginesClearRound,
  type EnginesClearedGroup,
  type EnginesConfig,
  type EnginesMove,
  type EnginesMoveReport,
  type EnginesPair,
  type EnginesState,
  type Segment,
} from "./types.js";

export const idx = (cfg: EnginesConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: EnginesConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: EnginesConfig, i: number): number => Math.floor(i / cfg.width);

type Cells = Array<Segment | null>;

/** Rotation kicks tried in order when a turn does not fit where the pair is: in place, one left, one right. */
export const ROTATION_KICKS: readonly number[] = [0, -1, 1];
/** A pair turns clockwise (+1) or counter-clockwise (+3, i.e. -1 mod 4). */
const TURNS: readonly number[] = [1, 3];

export function validateConfig(cfg: EnginesConfig): void {
  const ok =
    Number.isInteger(cfg.width) &&
    cfg.width >= 4 &&
    cfg.width <= 16 &&
    Number.isInteger(cfg.height) &&
    cfg.height >= 8 &&
    cfg.height <= 32 &&
    Number.isInteger(cfg.pieceKinds) &&
    cfg.pieceKinds >= 2 &&
    cfg.pieceKinds <= 8 &&
    Number.isInteger(cfg.injectorsAtOnce) &&
    cfg.injectorsAtOnce >= 0 &&
    cfg.injectorsAtOnce <= 8 &&
    Number.isInteger(cfg.injectorSpanMin) &&
    cfg.injectorSpanMin >= 1 &&
    cfg.injectorSpanMax >= cfg.injectorSpanMin &&
    cfg.injectorSpanMax <= cfg.width &&
    cfg.injectorPoints >= 0 &&
    cfg.runPoints >= 0 &&
    Number.isInteger(cfg.flameoutPenalty) &&
    cfg.flameoutPenalty >= 0 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0 &&
    Array.isArray(cfg.chainMultipliers) &&
    cfg.chainMultipliers.length >= 1 &&
    cfg.chainMultipliers.length <= 16 &&
    cfg.chainMultipliers.every((m) => Number.isInteger(m) && m >= 1 && m <= 1000);
  if (!ok) throw new Error("invalid flying config");
}

export function createEnginesGame(seed: string, config: EnginesConfig = DEFAULT_ENGINES_CONFIG): EnginesState {
  validateConfig(config);
  let rng = seedFromString(`sailing:${seed}`);
  const cells: Cells = new Array<Segment | null>(config.width * config.height).fill(null);
  const p1 = dealPair(config, rng);
  rng = p1.rng;
  const p2 = dealPair(config, rng);
  rng = p2.rng;
  const spawned = spawnInjectors(config, cells, [], rng, 1);
  return {
    config,
    cells,
    injectors: spawned.injectors,
    current: p1.pair,
    next: p2.pair,
    rng: spawned.rng,
    nextId: 1,
    nextPair: 1,
    nextInjectorId: spawned.nextInjectorId,
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

function dealPair(cfg: EnginesConfig, rng: PrngState): { pair: EnginesPair; rng: PrngState } {
  const a = nextInt(rng, cfg.pieceKinds);
  const b = nextInt(a.state, cfg.pieceKinds);
  return { pair: { a: a.value, b: b.value }, rng: b.state };
}

/** Every pair enters here: horizontal, in the middle of the top row. */
export function spawnPosition(cfg: EnginesConfig): { col: number; row: number; rot: Rotation } {
  return { col: Math.floor((cfg.width - 2) / 2), row: cfg.height - 1, rot: 0 };
}

/** The two cells a pair occupies when anchored at (col, row) with rotation rot, a first then b. */
export function pairCells(cfg: EnginesConfig, col: number, row: number, rot: Rotation): { a: number; b: number } | null {
  const inb = (c: number, r: number): boolean => c >= 0 && c < cfg.width && r >= 0 && r < cfg.height;
  switch (rot) {
    case 0:
      return inb(col, row) && inb(col + 1, row) ? { a: idx(cfg, col, row), b: idx(cfg, col + 1, row) } : null;
    case 1:
      return inb(col, row) && inb(col, row - 1) ? { a: idx(cfg, col, row - 1), b: idx(cfg, col, row) } : null;
    case 2:
      return inb(col, row) && inb(col + 1, row) ? { a: idx(cfg, col + 1, row), b: idx(cfg, col, row) } : null;
    case 3:
      return inb(col, row) && inb(col, row - 1) ? { a: idx(cfg, col, row), b: idx(cfg, col, row - 1) } : null;
    default:
      return null;
  }
}

/**
 * True when the pair fits at (col, row, rot): both cells on the board and empty, and, for a
 * vertical pair, the upper half not in an injector cell, since the shelf under that cell would run
 * between the two halves.
 */
export function fits(state: EnginesState, col: number, row: number, rot: Rotation): boolean {
  return fitsWith(state, injectorMask(state.config, state.injectors), col, row, rot);
}

function fitsWith(state: EnginesState, shelf: Uint8Array, col: number, row: number, rot: Rotation): boolean {
  const cells = pairCells(state.config, col, row, rot);
  if (cells === null || state.cells[cells.a] !== null || state.cells[cells.b] !== null) return false;
  if (rot === 1 || rot === 3) {
    const upper = Math.max(cells.a, cells.b);
    if (shelf[upper]) return false;
  }
  return true;
}

/** True when the pair at (col, row, rot) can fall one row: nothing beneath either half and no shelf under it. */
export function canDrop(state: EnginesState, col: number, row: number, rot: Rotation): boolean {
  return canDropWith(state, injectorMask(state.config, state.injectors), col, row, rot);
}

function canDropWith(state: EnginesState, shelf: Uint8Array, col: number, row: number, rot: Rotation): boolean {
  const cells = pairCells(state.config, col, row, rot);
  if (!cells) return false;
  return canFall(state.config, state.cells, shelf, [cells.a, cells.b]);
}

/** The pair can be entered at all: the spawn cells are free. When they are not, the core is full. */
export function spawnFree(state: EnginesState): boolean {
  const s = spawnPosition(state.config);
  return fits(state, s.col, s.row, s.rot);
}

const key = (col: number, row: number, rot: number): number => (rot * 64 + row) * 64 + col;

/**
 * Every resting position the current pair can reach from the spawn by sliding, turning (with
 * kicks) and falling. Sliding is allowed at any height, so a pair can be tucked under an injector.
 * Returns a set of packed `col,row,rot` keys; see `restingPlacements` for a list.
 */
export function reachableRests(state: EnginesState): Set<number> {
  const cfg = state.config;
  const shelf = injectorMask(cfg, state.injectors);
  const start = spawnPosition(cfg);
  const rests = new Set<number>();
  if (state.finished || !fitsWith(state, shelf, start.col, start.row, start.rot)) return rests;
  const seen = new Set<number>([key(start.col, start.row, start.rot)]);
  const queue: Array<{ col: number; row: number; rot: Rotation }> = [start];
  const visit = (col: number, row: number, rot: Rotation): void => {
    const k = key(col, row, rot);
    if (seen.has(k) || !fitsWith(state, shelf, col, row, rot)) return;
    seen.add(k);
    queue.push({ col, row, rot });
  };
  while (queue.length) {
    const p = queue.shift()!;
    if (canDropWith(state, shelf, p.col, p.row, p.rot)) visit(p.col, p.row - 1, p.rot);
    else rests.add(key(p.col, p.row, p.rot));
    visit(p.col - 1, p.row, p.rot);
    visit(p.col + 1, p.row, p.rot);
    // Turn either way: clockwise (+1) or counter-clockwise (+3), each with the same kicks.
    for (const turn of TURNS) {
      const rot = ((p.rot + turn) % 4) as Rotation;
      for (const kick of ROTATION_KICKS) {
        if (fitsWith(state, shelf, p.col + kick, p.row, rot)) {
          visit(p.col + kick, p.row, rot);
          break;
        }
      }
    }
  }
  return rests;
}

export function restingPlacements(state: EnginesState): Array<{ col: number; row: number; rot: Rotation }> {
  const out: Array<{ col: number; row: number; rot: Rotation }> = [];
  for (const k of reachableRests(state)) {
    const col = k % 64;
    const row = Math.floor(k / 64) % 64;
    const rot = Math.floor(k / 4096) as Rotation;
    out.push({ col, row, rot });
  }
  return out.sort((a, b) => a.rot - b.rot || a.row - b.row || a.col - b.col);
}

export function placeIllegalReason(state: EnginesState, col: number, row: number, rot: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(col) || !Number.isInteger(row) || !Number.isInteger(rot) || rot < 0 || rot > 3) return "bad placement";
  if (!fits(state, col, row, rot as Rotation)) return "does not fit";
  if (!reachableRests(state).has(key(col, row, rot))) return "not reachable";
  return null;
}

/** Where a pair at (col, row, rot) comes to rest if it falls straight down from there. */
export function landingRow(state: EnginesState, col: number, row: number, rot: Rotation): number {
  let r = row;
  while (canDrop(state, col, r, rot)) r--;
  return r;
}

export function reduceEngines(state: EnginesState, move: EnginesMove): EnginesState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, finished: true, lastMove: { move, landed: null, rounds: [], points: 0, wipe: null } };
    case "place":
      return applyPlace(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

export function replayEngines(seed: string, moves: readonly EnginesMove[], config: EnginesConfig = DEFAULT_ENGINES_CONFIG): EnginesState {
  let s = createEnginesGame(seed, config);
  for (const m of moves) s = reduceEngines(s, m);
  return s;
}

export function hashEnginesState(state: EnginesState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height).int(state.config.pieceKinds);
  for (const s of state.cells) {
    if (s === null) h.int(-1);
    else h.int(s.id).int(s.kind).int(s.pair);
  }
  for (const p of state.injectors) {
    h.int(p.id).int(p.cells.length);
    for (const c of p.cells) h.int(c.col).int(c.row).int(c.want === null ? -1 : c.want);
  }
  h.int(state.current.a).int(state.current.b).int(state.next.a).int(state.next.b);
  h.int(state.nextId).int(state.nextPair).int(state.nextInjectorId).int(state.moveCount).int(state.score).int(state.combo);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface EnginesSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeEngines(state: EnginesState): EnginesSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

// ---- internals

function applyPlace(state: EnginesState, move: Extract<EnginesMove, { type: "place" }>): EnginesState {
  const reason = placeIllegalReason(state, move.col, move.row, move.rot);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cfg = state.config;
  const cells: Cells = state.cells.slice();
  let injectors = state.injectors.slice();
  let rng = state.rng;
  let nextId = state.nextId;
  let nextInjectorId = state.nextInjectorId;

  const landing = pairCells(cfg, move.col, move.row, move.rot)!;
  const pair = state.nextPair;
  const segA: Segment = { id: nextId++, kind: state.current.a, pair };
  const segB: Segment = { id: nextId++, kind: state.current.b, pair };
  cells[landing.a] = segA;
  cells[landing.b] = segB;

  const rounds: EnginesClearRound[] = [];
  let chain = 1;
  for (;;) {
    const groups = findClears(cfg, cells, injectors);
    if (groups.length === 0) break;
    const base = groups.reduce((sum, g) => sum + g.points, 0);
    const points = base * groups.length * cfg.chainMultipliers[Math.min(chain, cfg.chainMultipliers.length) - 1]!;
    const clearedInjectors = new Set(groups.filter((g) => g.injectorId !== undefined).map((g) => g.injectorId!));
    for (const g of groups) for (const c of g.cells) cells[c] = null;
    injectors = injectors.filter((p) => !clearedInjectors.has(p.id));
    settle(cfg, cells, injectors);
    const spawned = spawnInjectors(cfg, cells, injectors, rng, nextInjectorId);
    injectors = spawned.injectors;
    rng = spawned.rng;
    nextInjectorId = spawned.nextInjectorId;
    rounds.push({ chain, groups, points, settled: cells.slice(), injectors: injectors.slice() });
    chain++;
  }
  // An injector that could not spawn earlier (no room) gets another chance after every move.
  if (rounds.length === 0) {
    const spawned = spawnInjectors(cfg, cells, injectors, rng, nextInjectorId);
    injectors = spawned.injectors;
    rng = spawned.rng;
    nextInjectorId = spawned.nextInjectorId;
  }

  const points = rounds.reduce((sum, r) => sum + r.points, 0);
  const dealt = dealPair(cfg, rng);
  const moveCount = state.moveCount + 1;
  let combo = points > 0 ? state.combo + 1 : 0;
  let score = state.score + points;
  let wipe: EnginesMoveReport["wipe"] = null;
  // Flamed out: the next pair cannot enter at the spawn. Clear the core, charge the penalty,
  // deal fresh injectors and carry on; the round ends on its clock or move budget, never by filling up.
  const probe: EnginesState = { ...state, cells, injectors, current: state.next, finished: false };
  if (!spawnFree(probe)) {
    const ids = cells.filter((s): s is Segment => s !== null).map((s) => s.id);
    cells.fill(null);
    const fresh = spawnInjectors(cfg, cells, [], dealt.rng, nextInjectorId);
    injectors = fresh.injectors;
    nextInjectorId = fresh.nextInjectorId;
    rng = fresh.rng;
    score = Math.max(0, score - cfg.flameoutPenalty);
    combo = 0;
    wipe = { ids, penalty: cfg.flameoutPenalty, injectors: injectors.slice() };
  } else {
    rng = dealt.rng;
  }
  const report: EnginesMoveReport = {
    move,
    landed: { cells: [landing.a, landing.b], ids: [segA.id, segB.id] },
    rounds,
    points,
    wipe,
  };
  return {
    config: cfg,
    cells,
    injectors,
    current: state.next,
    next: dealt.pair,
    rng,
    nextId,
    nextPair: pair + 1,
    nextInjectorId,
    moveCount,
    score,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

/** 1 for every injector cell with a shelf under it: one with no cell of the same injector directly beneath. */
export function shelfMask(cfg: EnginesConfig, injectors: readonly Injector[]): Uint8Array {
  const mask = new Uint8Array(cfg.width * cfg.height);
  for (const p of injectors) {
    for (const c of p.cells) {
      const below = p.cells.some((o) => o.col === c.col && o.row === c.row - 1);
      if (!below) mask[idx(cfg, c.col, c.row)] = 1;
    }
  }
  return mask;
}
const injectorMask = shelfMask;

/** A unit (one or two cells) can fall one row when none of its cells sits on a shelf and every cell below is free or its own. */
function canFall(cfg: EnginesConfig, cells: ReadonlyArray<Segment | null>, shelf: Uint8Array, unit: readonly number[]): boolean {
  for (const c of unit) {
    if (rowOf(cfg, c) === 0) return false;
    if (shelf[c]) return false;
    const below = c - cfg.width;
    if (cells[below] !== null && !unit.includes(below)) return false;
  }
  return true;
}

/** Gravity. Linked pairs fall together; a half whose partner is gone falls alone. */
function settle(cfg: EnginesConfig, cells: Cells, injectors: readonly Injector[]): void {
  const shelf = injectorMask(cfg, injectors);
  for (;;) {
    let moved = false;
    // Units keyed by pair id, visited bottom to top so stacks fall together in one pass.
    const seen = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const s = cells[i];
      if (s === null || s === undefined || seen.has(s.pair)) continue;
      seen.add(s.pair);
      const unit = [i];
      for (let j = i + 1; j < cells.length; j++) if (cells[j]?.pair === s.pair) unit.push(j);
      if (!canFall(cfg, cells, shelf, unit)) continue;
      // Move lowest cells first so a vertical pair does not overwrite itself.
      unit.sort((a, b) => a - b);
      for (const c of unit) {
        cells[c - cfg.width] = cells[c] ?? null;
        cells[c] = null;
      }
      moved = true;
    }
    if (!moved) return;
  }
}

/** Every run of 4+ and every satisfied injector on the board right now. */
function findClears(cfg: EnginesConfig, cells: ReadonlyArray<Segment | null>, injectors: readonly Injector[]): EnginesClearedGroup[] {
  const groups: EnginesClearedGroup[] = [];
  const matched = new Uint8Array(cells.length);
  const kindAt = (c: number, r: number): number => cells[idx(cfg, c, r)]?.kind ?? -1;
  for (let r = 0; r < cfg.height; r++) {
    let start = 0;
    for (let c = 1; c <= cfg.width; c++) {
      if (c === cfg.width || kindAt(c, r) !== kindAt(start, r)) {
        if (c - start >= 4 && kindAt(start, r) >= 0) for (let k = start; k < c; k++) matched[idx(cfg, k, r)] = 1;
        start = c;
      }
    }
  }
  for (let c = 0; c < cfg.width; c++) {
    let start = 0;
    for (let r = 1; r <= cfg.height; r++) {
      if (r === cfg.height || kindAt(c, r) !== kindAt(c, start)) {
        if (r - start >= 4 && kindAt(c, start) >= 0) for (let k = start; k < r; k++) matched[idx(cfg, c, k)] = 1;
        start = r;
      }
    }
  }
  // Connected components of matched cells of one kind, so a crossing counts once and scores as one shape.
  const seen = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (!matched[i] || seen[i]) continue;
    const kind = cells[i]!.kind;
    const group: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      const c = colOf(cfg, cur);
      const r = rowOf(cfg, cur);
      for (const n of [c > 0 ? cur - 1 : -1, c < cfg.width - 1 ? cur + 1 : -1, r > 0 ? cur - cfg.width : -1, r < cfg.height - 1 ? cur + cfg.width : -1]) {
        if (n < 0 || seen[n] || !matched[n] || cells[n]!.kind !== kind) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    group.sort((a, b) => a - b);
    groups.push({ cells: group, ids: group.map((c) => cells[c]!.id), points: cfg.runPoints * Math.max(1, group.length - 3), cause: "run" });
  }
  for (const p of injectors) {
    const targetCells: number[] = [];
    let satisfied = true;
    for (const cell of p.cells) {
      if (cell.want === null) continue;
      const c = idx(cfg, cell.col, cell.row);
      if (cells[c]?.kind !== cell.want) {
        satisfied = false;
        break;
      }
      targetCells.push(c);
    }
    if (!satisfied || targetCells.length === 0) continue;
    groups.push({ cells: targetCells, ids: targetCells.map((c) => cells[c]!.id), points: cfg.injectorPoints * targetCells.length, cause: "injector", injectorId: p.id });
  }
  groups.sort((a, b) => a.cells[0]! - b.cells[0]!);
  return groups;
}

/** Shapes an injector can take, as cells relative to a bottom-left origin (row up). Bars come from config. */
const FIXED_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [0, 1]], // stack of two
  [[0, 0], [0, 1], [0, 2]], // stack of three
  [[0, 0], [1, 0], [0, 1]], // L, corner bottom left
  [[0, 0], [1, 0], [1, 1]], // L, corner bottom right
  [[0, 0], [0, 1], [1, 1]], // L, corner top left
  [[1, 0], [0, 1], [1, 1]], // L, corner top right
  [[0, 0], [1, 0], [0, 1], [1, 1]], // square
];

function injectorShapes(cfg: EnginesConfig): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
  const bars: Array<ReadonlyArray<readonly [number, number]>> = [];
  for (let span = cfg.injectorSpanMin; span <= cfg.injectorSpanMax; span++) {
    bars.push(Array.from({ length: span }, (_, i) => [i, 0] as const));
  }
  return [...bars, ...FIXED_SHAPES];
}

/** Two injectors must not touch, not even at a corner, so each shape reads on its own. */
function touches(a: readonly InjectorCell[], b: readonly InjectorCell[]): boolean {
  for (const x of a) for (const y of b) if (Math.abs(x.col - y.col) <= 1 && Math.abs(x.row - y.row) <= 1) return true;
  return false;
}

/**
 * Bring the injector count back up to `injectorsAtOnce`. A shape is dealt where every cell and the
 * cell above each of its top cells are empty, rows 2..height-4, clear of every other injector.
 * Each cell wants a kind two times in three, else it is blank; at least one cell wants something.
 * When nothing fits the deal is retried after the next move.
 */
function spawnInjectors(
  cfg: EnginesConfig,
  cells: ReadonlyArray<Segment | null>,
  injectors: readonly Injector[],
  rng: PrngState,
  nextInjectorId: number,
): { injectors: Injector[]; rng: PrngState; nextInjectorId: number } {
  const out = injectors.slice();
  const shapes = injectorShapes(cfg);
  while (out.length < cfg.injectorsAtOnce) {
    const shapeRoll = nextInt(rng, shapes.length);
    rng = shapeRoll.state;
    const shape = shapes[shapeRoll.value]!;
    const w = Math.max(...shape.map(([c]) => c)) + 1;
    const h = Math.max(...shape.map(([, r]) => r)) + 1;
    const spots: Array<{ row: number; col: number }> = [];
    for (let row = 2; row + h - 1 <= cfg.height - 4; row++) {
      for (let col = 0; col + w <= cfg.width; col++) {
        const placed: InjectorCell[] = shape.map(([dc, dr]) => ({ col: col + dc, row: row + dr, want: null }));
        let free = true;
        for (const c of placed) {
          if (cells[idx(cfg, c.col, c.row)] !== null) free = false;
          const topOfColumn = !placed.some((o) => o.col === c.col && o.row === c.row + 1);
          if (topOfColumn && c.row + 1 < cfg.height && cells[idx(cfg, c.col, c.row + 1)] !== null) free = false;
          if (!free) break;
        }
        if (free && out.every((p) => !touches(p.cells, placed))) spots.push({ row, col });
      }
    }
    if (spots.length === 0) break;
    const pick = nextInt(rng, spots.length);
    rng = pick.state;
    const spot = spots[pick.value]!;
    const dealt: InjectorCell[] = [];
    for (const [dc, dr] of shape) {
      const blank = nextInt(rng, 3);
      rng = blank.state;
      let want: number | null = null;
      if (blank.value !== 0 || shape.length === 1) {
        const kind = nextInt(rng, cfg.pieceKinds);
        rng = kind.state;
        want = kind.value;
      }
      dealt.push({ col: spot.col + dc, row: spot.row + dr, want });
    }
    if (!dealt.some((c) => c.want !== null)) {
      const kind = nextInt(rng, cfg.pieceKinds);
      rng = kind.state;
      dealt[0] = { ...dealt[0]!, want: kind.value };
    }
    out.push({ id: nextInjectorId++, cells: dealt });
  }
  return { injectors: out, rng, nextInjectorId };
}
