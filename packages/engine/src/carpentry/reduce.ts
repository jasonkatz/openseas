import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import { PENTOMINOES, extent, orient } from "./shapes.js";
import {
  DEFAULT_CARPENTRY_CONFIG,
  type CarpentryConfig,
  type CarpentryMove,
  type CarpentryMoveReport,
  type CarpentryState,
  type Grain,
  type Hole,
  type HoleRating,
  type OfferedPiece,
  type PatchedHole,
  type Plank,
} from "./types.js";

export const idx = (cfg: CarpentryConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: CarpentryConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: CarpentryConfig, i: number): number => Math.floor(i / cfg.width);

const SLOTS = 3;
const RATINGS: readonly HoleRating[] = ["masterpiece", "craftsmanship", "fair", "sloppy", "pig"];

export function validateConfig(cfg: CarpentryConfig): void {
  const ok =
    Number.isInteger(cfg.width) &&
    cfg.width >= 5 &&
    cfg.width <= 20 &&
    Number.isInteger(cfg.height) &&
    cfg.height >= 5 &&
    cfg.height <= 24 &&
    Number.isInteger(cfg.pieceKinds) &&
    cfg.pieceKinds >= 1 &&
    cfg.pieceKinds <= 8 &&
    Number.isInteger(cfg.holesAtOnce) &&
    cfg.holesAtOnce >= 1 &&
    cfg.holesAtOnce <= 6 &&
    Number.isInteger(cfg.minHolePieces) &&
    cfg.minHolePieces >= 1 &&
    Number.isInteger(cfg.maxHolePieces) &&
    cfg.maxHolePieces >= cfg.minHolePieces &&
    cfg.maxHolePieces <= 6 &&
    cfg.basePerCell >= 0 &&
    RATINGS.every((r) => cfg.multiplierPercent[r] >= 0) &&
    cfg.grainBonusPercent >= 0 &&
    Number.isInteger(cfg.growAfterMoves) &&
    cfg.growAfterMoves >= 1 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0 &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000);
  if (!ok) throw new Error("invalid carpentry config");
}

export function createCarpentryGame(seed: string, config: CarpentryConfig = DEFAULT_CARPENTRY_CONFIG): CarpentryState {
  validateConfig(config);
  let rng = seedFromString(`carpentry:${seed}`);
  const slots: OfferedPiece[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const d = dealPiece(config, rng);
    rng = d.rng;
    slots.push(d.piece);
  }
  const covered = new Array<number>(config.width * config.height).fill(0);
  const spawned = spawnHoles(config, [], covered, rng, 1);
  const state: CarpentryState = {
    config,
    holes: spawned.holes,
    planks: [],
    covered,
    slots,
    rng: spawned.rng,
    nextId: spawned.nextId,
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    patchedCount: 0,
    lastMove: null,
    finished: false,
  };
  return { ...state, finished: !hasLegalPlacement(state) };
}

function dealPiece(cfg: CarpentryConfig, rng: PrngState): { piece: OfferedPiece; rng: PrngState } {
  const shape = nextInt(rng, PENTOMINOES.length);
  const grain = nextInt(shape.state, 2);
  const kind = nextInt(grain.state, cfg.pieceKinds);
  return { piece: { shape: shape.value, grain: grain.value === 0 ? "h" : "v", kind: kind.value }, rng: kind.state };
}

/** Grain of an offered piece once rotated: a quarter turn swaps it. */
export function effectiveGrain(grain: Grain, rot: number): Grain {
  return rot % 2 === 0 ? grain : grain === "h" ? "v" : "h";
}

/** Board cells a placement covers when every cell is on the board, or null when any is not. */
export function placementCells(cfg: CarpentryConfig, shape: number, rot: number, flip: boolean, col: number, row: number): number[] | null {
  const cells = orient(shape, rot, flip);
  const { w, h } = extent(cells);
  if (col < 0 || row < 0 || col + w > cfg.width || row + h > cfg.height) return null;
  return cells.map(([x, y]) => idx(cfg, col + x, row + y));
}

export interface PlacementCheck {
  readonly legal: boolean;
  readonly reason: string | null;
  readonly cells: readonly number[];
  /** The hole this plank would belong to. */
  readonly holeId: number | null;
  /** On-board cells that count as waste: hull cells, already-covered hole cells, and cells that are not laid. */
  readonly wasteCells: readonly number[];
  /** Cells hanging off the board; waste too, and never drawn. */
  readonly overhang: number;
}

/**
 * Everything a placement would do, without applying it. Drives the valid-placement highlight.
 *
 * A plank may be laid anywhere that covers at least one open hole cell. It joins the hole it
 * covers most of (the lowest id on a tie). Parts that hang off the board, lie over another hole,
 * or lie over hull a plank already covers are not laid: they cover nothing and count as waste, so a
 * hole beside an edge or beside another hole can always be worked.
 */
export function checkPlacement(state: CarpentryState, slot: number, rot: number, flip: boolean, col: number, row: number, holeOf?: ReadonlyMap<number, number>): PlacementCheck {
  const none = (reason: string): PlacementCheck => ({ legal: false, reason, cells: [], holeId: null, wasteCells: [], overhang: 0 });
  if (state.finished) return none("game is finished");
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) return none("bad slot");
  if (!Number.isInteger(rot) || rot < 0 || rot > 3 || typeof flip !== "boolean") return none("bad orientation");
  if (!Number.isInteger(col) || !Number.isInteger(row)) return none("bad position");
  const cfg = state.config;
  const piece = state.slots[slot]!;
  const oriented = orient(piece.shape, rot, flip);
  if (!holeOf) holeOf = holeIndex(state);
  // Which hole does this plank work? The one it covers most fresh cells of.
  const fresh = new Map<number, number>();
  let overhang = 0;
  const onBoard: number[] = [];
  for (const [x, y] of oriented) {
    const c0 = col + x;
    const r0 = row + y;
    if (c0 < 0 || r0 < 0 || c0 >= cfg.width || r0 >= cfg.height) {
      overhang++;
      continue;
    }
    const c = idx(cfg, c0, r0);
    onBoard.push(c);
    const h = holeOf.get(c);
    if (h !== undefined && state.covered[c] === 0) fresh.set(h, (fresh.get(h) ?? 0) + 1);
  }
  let holeId: number | null = null;
  let best = 0;
  for (const [h, n] of fresh) {
    if (n > best || (n === best && holeId !== null && h < holeId)) {
      holeId = h;
      best = n;
    }
  }
  if (holeId === null) return { legal: false, reason: "plank covers no open hole cell", cells: [], holeId: null, wasteCells: [], overhang };
  const cells: number[] = [];
  const wasteCells: number[] = [];
  for (const c of onBoard) {
    const h = holeOf.get(c);
    if (h === undefined) {
      if (state.covered[c]! > 0) wasteCells.push(c); // lies over a plank already on the hull: not laid
      else {
        cells.push(c);
        wasteCells.push(c);
      }
    } else if (h !== holeId) {
      wasteCells.push(c); // another hole: not laid
    } else {
      cells.push(c);
      if (state.covered[c]! > 0) wasteCells.push(c);
    }
  }
  return { legal: true, reason: null, cells, holeId, wasteCells, overhang };
}

/** Cell index to hole id for every hole cell. */
export function holeIndex(state: CarpentryState): Map<number, number> {
  const holeOf = new Map<number, number>();
  for (const h of state.holes) for (const c of h.cells) holeOf.set(c, h.id);
  return holeOf;
}

export function hasLegalPlacement(state: CarpentryState): boolean {
  if (state.finished) return false;
  const cfg = state.config;
  const holeOf = holeIndex(state);
  for (let slot = 0; slot < state.slots.length; slot++) {
    for (let rot = 0; rot < 4; rot++) {
      for (const flip of [false, true]) {
        for (let row = 0; row < cfg.height; row++) {
          for (let col = 0; col < cfg.width; col++) {
            if (checkPlacement(state, slot, rot, flip, col, row, holeOf).legal) return true;
          }
        }
      }
    }
  }
  return false;
}

export function reduceCarpentry(state: CarpentryState, move: CarpentryMove): CarpentryState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, finished: true, lastMove: { move, placed: null, patched: null, spawned: [], grown: null, points: 0 } };
    case "place":
      return applyPlace(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

export function replayCarpentry(seed: string, moves: readonly CarpentryMove[], config: CarpentryConfig = DEFAULT_CARPENTRY_CONFIG): CarpentryState {
  let s = createCarpentryGame(seed, config);
  for (const m of moves) s = reduceCarpentry(s, m);
  return s;
}

export function hashCarpentryState(state: CarpentryState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height);
  for (const c of state.covered) h.int(c);
  for (const hole of state.holes) {
    h.int(hole.id).int(hole.pieces).int(hole.waste).int(hole.idleMoves).int(hole.grown ? 1 : 0).int(hole.allHorizontal ? 1 : 0);
    for (const c of hole.cells) h.int(c);
  }
  for (const p of state.planks) {
    h.int(p.id).int(p.shape).int(p.kind).int(p.holeId).int(p.grain === "h" ? 0 : 1);
    for (const c of p.cells) h.int(c);
  }
  for (const s of state.slots) h.int(s.shape).int(s.kind).int(s.grain === "h" ? 0 : 1);
  h.int(state.nextId).int(state.moveCount).int(state.score).int(state.combo).int(state.patchedCount);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface CarpentrySummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeCarpentry(state: CarpentryState): CarpentrySummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** Rating for a hole patched with `pieces` planks and `waste` wasted cells. */
export function rateHole(area: number, pieces: number, waste: number): { rating: HoleRating; extra: number } {
  const extra = Math.max(0, pieces - Math.ceil(area / 5));
  if (extra === 0 && waste > 0) return { rating: "craftsmanship", extra };
  return { rating: RATINGS[Math.min(RATINGS.length - 1, extra)]!, extra };
}

// ---- internals

function applyPlace(state: CarpentryState, move: Extract<CarpentryMove, { type: "place" }>): CarpentryState {
  const check = checkPlacement(state, move.slot, move.rot, move.flip, move.col, move.row);
  if (!check.legal) throw new InvalidMoveError(check.reason ?? "illegal placement", move);
  const cfg = state.config;
  const piece = state.slots[move.slot]!;
  const grain = effectiveGrain(piece.grain, move.rot);
  let nextId = state.nextId;
  let rng = state.rng;
  const covered = state.covered.slice();
  for (const c of check.cells) covered[c] = covered[c]! + 1;
  const plank: Plank = { id: nextId++, shape: piece.shape, kind: piece.kind, grain, cells: check.cells, holeId: check.holeId! };
  let planks = [...state.planks, plank];

  // Work the hole; every other hole idles, and one that idles long enough grows.
  let grown: CarpentryMoveReport["grown"] = null;
  let holes: Hole[] = [];
  for (const h of state.holes) {
    if (h.id === plank.holeId) {
      holes.push({ ...h, pieces: h.pieces + 1, waste: h.waste + check.wasteCells.length + check.overhang, idleMoves: 0, allHorizontal: h.allHorizontal && grain === "h" });
      continue;
    }
    const idle = h.idleMoves + 1;
    if (idle < cfg.growAfterMoves || grown !== null) {
      holes.push({ ...h, idleMoves: idle });
      continue;
    }
    const candidates = growthCells(cfg, h, state.holes, covered);
    if (candidates.length === 0) {
      holes.push({ ...h, idleMoves: 0 });
      continue;
    }
    const pick = nextInt(rng, candidates.length);
    rng = pick.state;
    const cell = candidates[pick.value]!;
    grown = { holeId: h.id, cell };
    holes.push({ ...h, cells: [...h.cells, cell].sort((a, b) => a - b), idleMoves: 0, grown: true });
  }

  // Patched?
  let patched: PatchedHole | null = null;
  let combo = state.combo;
  let points = 0;
  const worked = holes.find((h) => h.id === plank.holeId)!;
  if (worked.cells.every((c) => covered[c]! > 0)) {
    const area = worked.cells.length;
    const { rating, extra } = rateHole(area, worked.pieces, worked.waste);
    const chain = rating === "masterpiece" ? combo + 1 : 1;
    combo = rating === "masterpiece" ? combo + 1 : 0;
    const grainBonus = worked.allHorizontal;
    const streakPercent = rating === "masterpiece" ? cfg.streakPercent[Math.min(chain, cfg.streakPercent.length) - 1]! : 100;
    let pts = (area * cfg.basePerCell * cfg.multiplierPercent[rating]) / 100;
    if (grainBonus) pts *= 1 + cfg.grainBonusPercent / 100;
    pts = Math.round((pts * streakPercent) / 100);
    points = pts;
    patched = { holeId: worked.id, cells: worked.cells, rating, extra, waste: worked.waste, grainBonus, chain, streakPercent, points: pts };
    // The hole is sound again: its planks come off the board and the hull is free for new holes.
    for (const p of planks) if (p.holeId === worked.id) for (const c of p.cells) covered[c] = Math.max(0, covered[c]! - 1);
    planks = planks.filter((p) => p.holeId !== worked.id);
    holes = holes.filter((h) => h.id !== worked.id);
  }

  const spawned = spawnHoles(cfg, holes, covered, rng, nextId);
  holes = spawned.holes;
  rng = spawned.rng;
  nextId = spawned.nextId;

  const dealt = dealPiece(cfg, rng);
  rng = dealt.rng;
  const slots = state.slots.map((s, i) => (i === move.slot ? dealt.piece : s));
  const moveCount = state.moveCount + 1;
  const report: CarpentryMoveReport = { move, placed: { plank, wasteCells: check.wasteCells }, patched, spawned: spawned.added, grown, points };
  const next: CarpentryState = {
    config: cfg,
    holes,
    planks,
    covered,
    slots,
    rng,
    nextId,
    moveCount,
    score: state.score + points,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    patchedCount: state.patchedCount + (patched ? 1 : 0),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
  if (!next.finished && !hasLegalPlacement(next)) return { ...next, finished: true };
  return next;
}

/** Cells within one step (including diagonals) of any cell of `holes` other than `except`. */
function forbiddenNear(cfg: CarpentryConfig, holes: readonly Hole[], except: number | null): Uint8Array {
  const mask = new Uint8Array(cfg.width * cfg.height);
  for (const h of holes) {
    if (h.id === except) continue;
    for (const c of h.cells) {
      const col = colOf(cfg, c);
      const row = rowOf(cfg, c);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const cc = col + dc;
          const rr = row + dr;
          if (cc >= 0 && cc < cfg.width && rr >= 0 && rr < cfg.height) mask[idx(cfg, cc, rr)] = 1;
        }
      }
    }
  }
  return mask;
}

function neighbours(cfg: CarpentryConfig, c: number): number[] {
  const col = colOf(cfg, c);
  const row = rowOf(cfg, c);
  const out: number[] = [];
  if (col > 0) out.push(c - 1);
  if (col < cfg.width - 1) out.push(c + 1);
  if (row > 0) out.push(c - cfg.width);
  if (row < cfg.height - 1) out.push(c + cfg.width);
  return out;
}

/** Uncovered hull cells edge-adjacent to `hole` that would not touch another hole. */
function growthCells(cfg: CarpentryConfig, hole: Hole, holes: readonly Hole[], covered: readonly number[]): number[] {
  const forbidden = forbiddenNear(cfg, holes, hole.id);
  const own = new Set(hole.cells);
  const out = new Set<number>();
  for (const c of hole.cells) {
    for (const n of neighbours(cfg, c)) {
      if (own.has(n) || covered[n]! > 0 || forbidden[n]) continue;
      out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Deal holes until `holesAtOnce` are on the board. A hole is a union of one or more pentominoes
 * laid edge to edge, so a masterpiece is always possible in principle. It must sit on uncovered
 * hull at least one cell clear of every other hole. When nothing fits, fewer holes are dealt and
 * the next move tries again.
 */
function spawnHoles(
  cfg: CarpentryConfig,
  holes: readonly Hole[],
  covered: readonly number[],
  rng: PrngState,
  nextId: number,
): { holes: Hole[]; added: Hole[]; rng: PrngState; nextId: number } {
  const out = holes.slice();
  const added: Hole[] = [];
  while (out.length < cfg.holesAtOnce) {
    const sizeRoll = nextInt(rng, cfg.maxHolePieces - cfg.minHolePieces + 1);
    rng = sizeRoll.state;
    const forbidden = forbiddenNear(cfg, out, null);
    const free = (c: number): boolean => !forbidden[c] && covered[c] === 0;
    let region: number[] | null = null;
    // Try the rolled size, then smaller ones, so a crowded hull still gets a hole if any pentomino fits.
    for (let size = cfg.minHolePieces + sizeRoll.value; size >= 1 && region === null; size--) {
      // A few attempts at a seed pentomino; each grows greedily with random adjacent pentominoes.
      for (let attempt = 0; attempt < 4 && region === null; attempt++) {
        const first = randomPlacement(cfg, rng, (cells) => cells.every(free));
        rng = first.rng;
        if (!first.cells) break;
        let cells = first.cells.slice();
        let ok = true;
        for (let k = 1; k < size; k++) {
          const set = new Set(cells);
          const more = randomPlacement(cfg, rng, (cs) => cs.every((c) => free(c) && !set.has(c)) && cs.some((c) => neighbours(cfg, c).some((n) => set.has(n))));
          rng = more.rng;
          if (!more.cells) {
            ok = false;
            break;
          }
          cells = cells.concat(more.cells);
        }
        if (ok) region = cells.sort((a, b) => a - b);
      }
    }
    if (region === null) break;
    const hole: Hole = { id: nextId++, cells: region, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true };
    out.push(hole);
    added.push(hole);
  }
  return { holes: out, added, rng, nextId };
}

/** A uniformly random pentomino placement among those passing `accept`, or null when none does. */
function randomPlacement(cfg: CarpentryConfig, rng: PrngState, accept: (cells: number[]) => boolean): { cells: number[] | null; rng: PrngState } {
  const options: number[][] = [];
  for (let shape = 0; shape < PENTOMINOES.length; shape++) {
    for (let rot = 0; rot < 4; rot++) {
      for (const flip of [false, true]) {
        const o = orient(shape, rot, flip);
        const { w, h } = extent(o);
        for (let row = 0; row + h <= cfg.height; row++) {
          for (let col = 0; col + w <= cfg.width; col++) {
            const cells = o.map(([x, y]) => idx(cfg, col + x, row + y));
            if (accept(cells)) options.push(cells);
          }
        }
      }
    }
  }
  if (options.length === 0) return { cells: null, rng };
  const pick = nextInt(rng, options.length);
  return { cells: options[pick.value]!, rng: pick.state };
}
