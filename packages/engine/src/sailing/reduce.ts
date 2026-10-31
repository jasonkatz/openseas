import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_SAILING_CONFIG,
  type Platform,
  type Rotation,
  type SailingClearRound,
  type SailingClearedGroup,
  type SailingConfig,
  type SailingMove,
  type SailingMoveReport,
  type SailingPair,
  type SailingState,
  type Segment,
} from "./types.js";

export const idx = (cfg: SailingConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: SailingConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: SailingConfig, i: number): number => Math.floor(i / cfg.width);

type Cells = Array<Segment | null>;

export function validateConfig(cfg: SailingConfig): void {
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
    Number.isInteger(cfg.platformsAtOnce) &&
    cfg.platformsAtOnce >= 0 &&
    cfg.platformsAtOnce <= 6 &&
    Number.isInteger(cfg.platformSpanMin) &&
    cfg.platformSpanMin >= 1 &&
    cfg.platformSpanMax >= cfg.platformSpanMin &&
    cfg.platformSpanMax <= cfg.width &&
    cfg.platformPoints >= 0 &&
    cfg.runPoints >= 0 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0;
  if (!ok) throw new Error("invalid sailing config");
}

export function createSailingGame(seed: string, config: SailingConfig = DEFAULT_SAILING_CONFIG): SailingState {
  validateConfig(config);
  let rng = seedFromString(`sailing:${seed}`);
  const cells: Cells = new Array<Segment | null>(config.width * config.height).fill(null);
  const p1 = dealPair(config, rng);
  rng = p1.rng;
  const p2 = dealPair(config, rng);
  rng = p2.rng;
  const spawned = spawnPlatforms(config, cells, [], rng, 1);
  const state: SailingState = {
    config,
    cells,
    platforms: spawned.platforms,
    current: p1.pair,
    next: p2.pair,
    rng: spawned.rng,
    nextId: 1,
    nextPair: 1,
    nextPlatformId: spawned.nextPlatformId,
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
  return { ...state, finished: !hasLegalPlacement(state) };
}

function dealPair(cfg: SailingConfig, rng: PrngState): { pair: SailingPair; rng: PrngState } {
  const a = nextInt(rng, cfg.pieceKinds);
  const b = nextInt(a.state, cfg.pieceKinds);
  return { pair: { a: a.value, b: b.value }, rng: b.state };
}

/** The two cells a pair occupies when anchored at (col, top) with rotation rot, a first then b. */
export function pairCells(cfg: SailingConfig, col: number, top: number, rot: Rotation): { a: number; b: number } | null {
  const inb = (c: number, r: number): boolean => c >= 0 && c < cfg.width && r >= 0 && r < cfg.height;
  switch (rot) {
    case 0:
      return inb(col, top) && inb(col + 1, top) ? { a: idx(cfg, col, top), b: idx(cfg, col + 1, top) } : null;
    case 1:
      return inb(col, top) && inb(col, top - 1) ? { a: idx(cfg, col, top - 1), b: idx(cfg, col, top) } : null;
    case 2:
      return inb(col, top) && inb(col + 1, top) ? { a: idx(cfg, col + 1, top), b: idx(cfg, col, top) } : null;
    case 3:
      return inb(col, top) && inb(col, top - 1) ? { a: idx(cfg, col, top), b: idx(cfg, col, top - 1) } : null;
    default:
      return null;
  }
}

export function placeIllegalReason(state: SailingState, col: number, rot: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(col) || !Number.isInteger(rot) || rot < 0 || rot > 3) return "bad placement";
  const cells = pairCells(state.config, col, state.config.height - 1, rot as Rotation);
  if (!cells) return "out of bounds";
  if (state.cells[cells.a] !== null || state.cells[cells.b] !== null) return "spawn cells occupied";
  return null;
}

export function hasLegalPlacement(state: SailingState): boolean {
  if (state.finished) return false;
  for (let rot = 0; rot < 4; rot++) {
    for (let col = 0; col < state.config.width; col++) {
      const cells = pairCells(state.config, col, state.config.height - 1, rot as Rotation);
      if (cells && state.cells[cells.a] === null && state.cells[cells.b] === null) return true;
    }
  }
  return false;
}

/** Where the current pair would come to rest, for the ghost piece. Null when the placement is illegal. */
export function landingCells(state: SailingState, col: number, rot: Rotation): { a: number; b: number } | null {
  if (placeIllegalReason(state, col, rot) !== null) return null;
  const cfg = state.config;
  const start = pairCells(cfg, col, cfg.height - 1, rot)!;
  const shelf = platformMask(cfg, state.platforms);
  let a = start.a;
  let b = start.b;
  for (;;) {
    const unit = [a, b];
    if (!canFall(cfg, state.cells, shelf, unit)) break;
    a -= cfg.width;
    b -= cfg.width;
  }
  return { a, b };
}

export function reduceSailing(state: SailingState, move: SailingMove): SailingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, finished: true, lastMove: { move, landed: null, rounds: [], points: 0 } };
    case "place":
      return applyPlace(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

export function replaySailing(seed: string, moves: readonly SailingMove[], config: SailingConfig = DEFAULT_SAILING_CONFIG): SailingState {
  let s = createSailingGame(seed, config);
  for (const m of moves) s = reduceSailing(s, m);
  return s;
}

export function hashSailingState(state: SailingState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height).int(state.config.pieceKinds);
  for (const s of state.cells) {
    if (s === null) h.int(-1);
    else h.int(s.id).int(s.kind).int(s.pair);
  }
  for (const p of state.platforms) {
    h.int(p.id).int(p.row).int(p.col).int(p.span);
    for (const t of p.targets) h.int(t === null ? -1 : t);
  }
  h.int(state.current.a).int(state.current.b).int(state.next.a).int(state.next.b);
  h.int(state.nextId).int(state.nextPair).int(state.nextPlatformId).int(state.moveCount).int(state.score).int(state.combo);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface SailingSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeSailing(state: SailingState): SailingSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

// ---- internals

function applyPlace(state: SailingState, move: Extract<SailingMove, { type: "place" }>): SailingState {
  const reason = placeIllegalReason(state, move.col, move.rot);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cfg = state.config;
  const cells: Cells = state.cells.slice();
  let platforms = state.platforms.slice();
  let rng = state.rng;
  let nextId = state.nextId;
  let nextPlatformId = state.nextPlatformId;

  const landing = landingCells(state, move.col, move.rot)!;
  const pair = state.nextPair;
  const segA: Segment = { id: nextId++, kind: state.current.a, pair };
  const segB: Segment = { id: nextId++, kind: state.current.b, pair };
  cells[landing.a] = segA;
  cells[landing.b] = segB;

  const rounds: SailingClearRound[] = [];
  let chain = 1;
  for (;;) {
    const groups = findClears(cfg, cells, platforms);
    if (groups.length === 0) break;
    const base = groups.reduce((sum, g) => sum + g.points, 0);
    const points = base * groups.length * chain;
    const clearedPlatforms = new Set(groups.filter((g) => g.platformId !== undefined).map((g) => g.platformId!));
    for (const g of groups) for (const c of g.cells) cells[c] = null;
    platforms = platforms.filter((p) => !clearedPlatforms.has(p.id));
    settle(cfg, cells, platforms);
    const spawned = spawnPlatforms(cfg, cells, platforms, rng, nextPlatformId);
    platforms = spawned.platforms;
    rng = spawned.rng;
    nextPlatformId = spawned.nextPlatformId;
    rounds.push({ chain, groups, points, settled: cells.slice(), platforms: platforms.slice() });
    chain++;
  }
  // A platform that could not spawn earlier (no room) gets another chance after every move.
  if (rounds.length === 0) {
    const spawned = spawnPlatforms(cfg, cells, platforms, rng, nextPlatformId);
    platforms = spawned.platforms;
    rng = spawned.rng;
    nextPlatformId = spawned.nextPlatformId;
  }

  const points = rounds.reduce((sum, r) => sum + r.points, 0);
  const dealt = dealPair(cfg, rng);
  const moveCount = state.moveCount + 1;
  const combo = points > 0 ? state.combo + 1 : 0;
  const report: SailingMoveReport = {
    move,
    landed: { cells: [landing.a, landing.b], ids: [segA.id, segB.id] },
    rounds,
    points,
  };
  const next: SailingState = {
    config: cfg,
    cells,
    platforms,
    current: state.next,
    next: dealt.pair,
    rng: dealt.rng,
    nextId,
    nextPair: pair + 1,
    nextPlatformId,
    moveCount,
    score: state.score + points,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
  if (!next.finished && !hasLegalPlacement(next)) return { ...next, finished: true };
  return next;
}

/** 1 for every cell that is part of a platform (a shelf under it). */
function platformMask(cfg: SailingConfig, platforms: readonly Platform[]): Uint8Array {
  const mask = new Uint8Array(cfg.width * cfg.height);
  for (const p of platforms) for (let i = 0; i < p.span; i++) mask[idx(cfg, p.col + i, p.row)] = 1;
  return mask;
}

/** A unit (one or two cells) can fall one row when none of its cells sits on a shelf and every cell below is free or its own. */
function canFall(cfg: SailingConfig, cells: ReadonlyArray<Segment | null>, shelf: Uint8Array, unit: readonly number[]): boolean {
  for (const c of unit) {
    if (rowOf(cfg, c) === 0) return false;
    if (shelf[c]) return false;
    const below = c - cfg.width;
    if (cells[below] !== null && !unit.includes(below)) return false;
  }
  return true;
}

/** Gravity. Linked pairs fall together; a half whose partner is gone falls alone. */
function settle(cfg: SailingConfig, cells: Cells, platforms: readonly Platform[]): void {
  const shelf = platformMask(cfg, platforms);
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

/** Every run of 4+ and every satisfied platform on the board right now. */
function findClears(cfg: SailingConfig, cells: ReadonlyArray<Segment | null>, platforms: readonly Platform[]): SailingClearedGroup[] {
  const groups: SailingClearedGroup[] = [];
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
  for (const p of platforms) {
    const targetCells: number[] = [];
    let satisfied = true;
    for (let i = 0; i < p.span; i++) {
      const want = p.targets[i];
      if (want === null || want === undefined) continue;
      const c = idx(cfg, p.col + i, p.row);
      if (cells[c]?.kind !== want) {
        satisfied = false;
        break;
      }
      targetCells.push(c);
    }
    if (!satisfied || targetCells.length === 0) continue;
    groups.push({ cells: targetCells, ids: targetCells.map((c) => cells[c]!.id), points: cfg.platformPoints * targetCells.length, cause: "platform", platformId: p.id });
  }
  groups.sort((a, b) => a.cells[0]! - b.cells[0]!);
  return groups;
}

/**
 * Bring the platform count back up to `platformsAtOnce`. A platform needs its span and the cells
 * above it empty, rows 2..height-4, and a row's gap from every other platform. When nothing fits
 * the spawn is retried after the next move.
 */
function spawnPlatforms(
  cfg: SailingConfig,
  cells: ReadonlyArray<Segment | null>,
  platforms: readonly Platform[],
  rng: PrngState,
  nextPlatformId: number,
): { platforms: Platform[]; rng: PrngState; nextPlatformId: number } {
  const out = platforms.slice();
  while (out.length < cfg.platformsAtOnce) {
    const spanRoll = nextInt(rng, cfg.platformSpanMax - cfg.platformSpanMin + 1);
    rng = spanRoll.state;
    const span = cfg.platformSpanMin + spanRoll.value;
    const spots: Array<{ row: number; col: number }> = [];
    for (let row = 2; row <= cfg.height - 4; row++) {
      if (out.some((p) => Math.abs(p.row - row) <= 1)) continue;
      for (let col = 0; col + span <= cfg.width; col++) {
        let free = true;
        for (let i = 0; i < span && free; i++) {
          if (cells[idx(cfg, col + i, row)] !== null || cells[idx(cfg, col + i, row + 1)] !== null) free = false;
        }
        if (free) spots.push({ row, col });
      }
    }
    if (spots.length === 0) break;
    const pick = nextInt(rng, spots.length);
    rng = pick.state;
    const spot = spots[pick.value]!;
    const targets: Array<number | null> = [];
    for (let i = 0; i < span; i++) {
      const blank = nextInt(rng, 3);
      rng = blank.state;
      if (blank.value === 0 && span > 1) {
        targets.push(null);
        continue;
      }
      const kind = nextInt(rng, cfg.pieceKinds);
      rng = kind.state;
      targets.push(kind.value);
    }
    if (!targets.some((t) => t !== null)) {
      const kind = nextInt(rng, cfg.pieceKinds);
      rng = kind.state;
      targets[0] = kind.value;
    }
    out.push({ id: nextPlatformId++, row: spot.row, col: spot.col, span, targets });
  }
  return { platforms: out, rng, nextPlatformId };
}
