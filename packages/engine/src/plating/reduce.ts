import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import { PENTOMINOES, extent, orient } from "./shapes.js";
import {
  DEFAULT_PLATING_CONFIG,
  type PlatingConfig,
  type PlatingMove,
  type PlatingMoveReport,
  type PlatingState,
  type Brush,
  type Breach,
  type BreachRating,
  type OfferedPiece,
  type SealedBreach,
  type Plate,
} from "./types.js";

export const idx = (cfg: PlatingConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: PlatingConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: PlatingConfig, i: number): number => Math.floor(i / cfg.width);

const SLOTS = 3;
const RATINGS: readonly BreachRating[] = ["flawless", "solid", "holds", "tape", "gum"];

export function validateConfig(cfg: PlatingConfig): void {
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
    Number.isInteger(cfg.breachesAtOnce) &&
    cfg.breachesAtOnce >= 1 &&
    cfg.breachesAtOnce <= 6 &&
    Number.isInteger(cfg.minBreachPieces) &&
    cfg.minBreachPieces >= 1 &&
    Number.isInteger(cfg.maxBreachPieces) &&
    cfg.maxBreachPieces >= cfg.minBreachPieces &&
    cfg.maxBreachPieces <= 6 &&
    cfg.basePerCell >= 0 &&
    RATINGS.every((r) => cfg.multiplierPercent[r] >= 0) &&
    cfg.brushBonusPercent >= 0 &&
    Number.isInteger(cfg.growAfterMoves) &&
    cfg.growAfterMoves >= 1 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0 &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000);
  if (!ok) throw new Error("invalid plating config");
}

export function createPlatingGame(seed: string, config: PlatingConfig = DEFAULT_PLATING_CONFIG): PlatingState {
  validateConfig(config);
  let rng = seedFromString(`carpentry:${seed}`);
  const slots: OfferedPiece[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const d = dealPiece(config, rng);
    rng = d.rng;
    slots.push(d.piece);
  }
  const covered = new Array<number>(config.width * config.height).fill(0);
  const spawned = spawnBreaches(config, [], covered, rng, 1);
  const state: PlatingState = {
    config,
    breaches: spawned.breaches,
    plates: [],
    covered,
    slots,
    rng: spawned.rng,
    nextId: spawned.nextId,
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    sealedCount: 0,
    lastMove: null,
    finished: false,
  };
  return { ...state, finished: !hasLegalPlacement(state) };
}

function dealPiece(cfg: PlatingConfig, rng: PrngState): { piece: OfferedPiece; rng: PrngState } {
  const shape = nextInt(rng, PENTOMINOES.length);
  const brush = nextInt(shape.state, 2);
  const kind = nextInt(brush.state, cfg.pieceKinds);
  return { piece: { shape: shape.value, brush: brush.value === 0 ? "h" : "v", kind: kind.value }, rng: kind.state };
}

/** Brush of an offered piece once rotated: a quarter turn swaps it. */
export function effectiveBrush(brush: Brush, rot: number): Brush {
  return rot % 2 === 0 ? brush : brush === "h" ? "v" : "h";
}

/** Board cells a placement covers when every cell is on the board, or null when any is not. */
export function placementCells(cfg: PlatingConfig, shape: number, rot: number, flip: boolean, col: number, row: number): number[] | null {
  const cells = orient(shape, rot, flip);
  const { w, h } = extent(cells);
  if (col < 0 || row < 0 || col + w > cfg.width || row + h > cfg.height) return null;
  return cells.map(([x, y]) => idx(cfg, col + x, row + y));
}

export interface PlacementCheck {
  readonly legal: boolean;
  readonly reason: string | null;
  readonly cells: readonly number[];
  /** The breach this plate would belong to. */
  readonly breachId: number | null;
  /** On-board cells that count as waste: hull cells, already-covered breach cells, and cells that are not laid. */
  readonly wasteCells: readonly number[];
  /** Cells hanging off the board; waste too, and never drawn. */
  readonly overhang: number;
}

/**
 * Everything a placement would do, without applying it. Drives the valid-placement highlight.
 *
 * A plate may be laid anywhere that covers at least one open breach cell. It joins the breach it
 * covers most of (the lowest id on a tie). Parts that hang off the board, lie over another breach,
 * or lie over hull a plate already covers are not laid: they cover nothing and count as waste, so a
 * breach beside an edge or beside another breach can always be worked.
 */
export function checkPlacement(state: PlatingState, slot: number, rot: number, flip: boolean, col: number, row: number, breachOf?: ReadonlyMap<number, number>): PlacementCheck {
  const none = (reason: string): PlacementCheck => ({ legal: false, reason, cells: [], breachId: null, wasteCells: [], overhang: 0 });
  if (state.finished) return none("game is finished");
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) return none("bad slot");
  if (!Number.isInteger(rot) || rot < 0 || rot > 3 || typeof flip !== "boolean") return none("bad orientation");
  if (!Number.isInteger(col) || !Number.isInteger(row)) return none("bad position");
  const cfg = state.config;
  const piece = state.slots[slot]!;
  const oriented = orient(piece.shape, rot, flip);
  if (!breachOf) breachOf = breachIndex(state);
  // Which breach does this plate work? The one it covers most fresh cells of.
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
    const h = breachOf.get(c);
    if (h !== undefined && state.covered[c] === 0) fresh.set(h, (fresh.get(h) ?? 0) + 1);
  }
  let breachId: number | null = null;
  let best = 0;
  for (const [h, n] of fresh) {
    if (n > best || (n === best && breachId !== null && h < breachId)) {
      breachId = h;
      best = n;
    }
  }
  if (breachId === null) return { legal: false, reason: "plate covers no open breach cell", cells: [], breachId: null, wasteCells: [], overhang };
  const cells: number[] = [];
  const wasteCells: number[] = [];
  for (const c of onBoard) {
    const h = breachOf.get(c);
    if (h === undefined) {
      if (state.covered[c]! > 0) wasteCells.push(c); // lies over a plate already on the hull: not laid
      else {
        cells.push(c);
        wasteCells.push(c);
      }
    } else if (h !== breachId) {
      wasteCells.push(c); // another breach: not laid
    } else {
      cells.push(c);
      if (state.covered[c]! > 0) wasteCells.push(c);
    }
  }
  return { legal: true, reason: null, cells, breachId, wasteCells, overhang };
}

/** Cell index to breach id for every breach cell. */
export function breachIndex(state: PlatingState): Map<number, number> {
  const breachOf = new Map<number, number>();
  for (const h of state.breaches) for (const c of h.cells) breachOf.set(c, h.id);
  return breachOf;
}

export function hasLegalPlacement(state: PlatingState): boolean {
  if (state.finished) return false;
  const cfg = state.config;
  const breachOf = breachIndex(state);
  for (let slot = 0; slot < state.slots.length; slot++) {
    for (let rot = 0; rot < 4; rot++) {
      for (const flip of [false, true]) {
        for (let row = 0; row < cfg.height; row++) {
          for (let col = 0; col < cfg.width; col++) {
            if (checkPlacement(state, slot, rot, flip, col, row, breachOf).legal) return true;
          }
        }
      }
    }
  }
  return false;
}

export function reducePlating(state: PlatingState, move: PlatingMove): PlatingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, finished: true, lastMove: { move, placed: null, sealed: null, spawned: [], grown: null, points: 0 } };
    case "place":
      return applyPlace(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

export function hashPlatingState(state: PlatingState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height);
  for (const c of state.covered) h.int(c);
  for (const breach of state.breaches) {
    h.int(breach.id).int(breach.pieces).int(breach.waste).int(breach.idleMoves).int(breach.grown ? 1 : 0).int(breach.allHorizontal ? 1 : 0);
    for (const c of breach.cells) h.int(c);
  }
  for (const p of state.plates) {
    h.int(p.id).int(p.shape).int(p.kind).int(p.breachId).int(p.brush === "h" ? 0 : 1);
    for (const c of p.cells) h.int(c);
  }
  for (const s of state.slots) h.int(s.shape).int(s.kind).int(s.brush === "h" ? 0 : 1);
  h.int(state.nextId).int(state.moveCount).int(state.score).int(state.combo).int(state.sealedCount);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface PlatingSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizePlating(state: PlatingState): PlatingSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** Rating for a breach sealed with `pieces` plates and `waste` wasted cells. */
export function rateBreach(area: number, pieces: number, waste: number): { rating: BreachRating; extra: number } {
  const extra = Math.max(0, pieces - Math.ceil(area / 5));
  if (extra === 0 && waste > 0) return { rating: "solid", extra };
  return { rating: RATINGS[Math.min(RATINGS.length - 1, extra)]!, extra };
}

// ---- internals

function applyPlace(state: PlatingState, move: Extract<PlatingMove, { type: "place" }>): PlatingState {
  const check = checkPlacement(state, move.slot, move.rot, move.flip, move.col, move.row);
  if (!check.legal) throw new InvalidMoveError(check.reason ?? "illegal placement", move);
  const cfg = state.config;
  const piece = state.slots[move.slot]!;
  const brush = effectiveBrush(piece.brush, move.rot);
  let nextId = state.nextId;
  let rng = state.rng;
  const covered = state.covered.slice();
  for (const c of check.cells) covered[c] = covered[c]! + 1;
  const plate: Plate = { id: nextId++, shape: piece.shape, kind: piece.kind, brush, cells: check.cells, breachId: check.breachId! };
  let plates = [...state.plates, plate];

  // Work the breach; every other breach idles, and one that idles long enough grows.
  let grown: PlatingMoveReport["grown"] = null;
  let breaches: Breach[] = [];
  for (const h of state.breaches) {
    if (h.id === plate.breachId) {
      breaches.push({ ...h, pieces: h.pieces + 1, waste: h.waste + check.wasteCells.length + check.overhang, idleMoves: 0, allHorizontal: h.allHorizontal && brush === "h" });
      continue;
    }
    const idle = h.idleMoves + 1;
    if (idle < cfg.growAfterMoves || grown !== null) {
      breaches.push({ ...h, idleMoves: idle });
      continue;
    }
    const candidates = growthCells(cfg, h, state.breaches, covered);
    if (candidates.length === 0) {
      breaches.push({ ...h, idleMoves: 0 });
      continue;
    }
    const pick = nextInt(rng, candidates.length);
    rng = pick.state;
    const cell = candidates[pick.value]!;
    grown = { breachId: h.id, cell };
    breaches.push({ ...h, cells: [...h.cells, cell].sort((a, b) => a - b), idleMoves: 0, grown: true });
  }

  // Sealed?
  let sealed: SealedBreach | null = null;
  let combo = state.combo;
  let points = 0;
  const worked = breaches.find((h) => h.id === plate.breachId)!;
  if (worked.cells.every((c) => covered[c]! > 0)) {
    const area = worked.cells.length;
    const { rating, extra } = rateBreach(area, worked.pieces, worked.waste);
    const chain = rating === "flawless" ? combo + 1 : 1;
    combo = rating === "flawless" ? combo + 1 : 0;
    const brushBonus = worked.allHorizontal;
    const streakPercent = rating === "flawless" ? cfg.streakPercent[Math.min(chain, cfg.streakPercent.length) - 1]! : 100;
    let pts = (area * cfg.basePerCell * cfg.multiplierPercent[rating]) / 100;
    if (brushBonus) pts *= 1 + cfg.brushBonusPercent / 100;
    pts = Math.round((pts * streakPercent) / 100);
    points = pts;
    sealed = { breachId: worked.id, cells: worked.cells, rating, extra, waste: worked.waste, brushBonus, chain, streakPercent, points: pts };
    // The breach is sound again: its plates come off the board and the hull is free for new breaches.
    for (const p of plates) if (p.breachId === worked.id) for (const c of p.cells) covered[c] = Math.max(0, covered[c]! - 1);
    plates = plates.filter((p) => p.breachId !== worked.id);
    breaches = breaches.filter((h) => h.id !== worked.id);
  }

  const spawned = spawnBreaches(cfg, breaches, covered, rng, nextId);
  breaches = spawned.breaches;
  rng = spawned.rng;
  nextId = spawned.nextId;

  const dealt = dealPiece(cfg, rng);
  rng = dealt.rng;
  const slots = state.slots.map((s, i) => (i === move.slot ? dealt.piece : s));
  const moveCount = state.moveCount + 1;
  const report: PlatingMoveReport = { move, placed: { plate, wasteCells: check.wasteCells }, sealed, spawned: spawned.added, grown, points };
  const next: PlatingState = {
    config: cfg,
    breaches,
    plates,
    covered,
    slots,
    rng,
    nextId,
    moveCount,
    score: state.score + points,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    sealedCount: state.sealedCount + (sealed ? 1 : 0),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
  if (!next.finished && !hasLegalPlacement(next)) return { ...next, finished: true };
  return next;
}

/** Cells within one step (including diagonals) of any cell of `breaches` other than `except`. */
function forbiddenNear(cfg: PlatingConfig, breaches: readonly Breach[], except: number | null): Uint8Array {
  const mask = new Uint8Array(cfg.width * cfg.height);
  for (const h of breaches) {
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

function neighbours(cfg: PlatingConfig, c: number): number[] {
  const col = colOf(cfg, c);
  const row = rowOf(cfg, c);
  const out: number[] = [];
  if (col > 0) out.push(c - 1);
  if (col < cfg.width - 1) out.push(c + 1);
  if (row > 0) out.push(c - cfg.width);
  if (row < cfg.height - 1) out.push(c + cfg.width);
  return out;
}

/** Uncovered hull cells edge-adjacent to `breach` that would not touch another breach. */
function growthCells(cfg: PlatingConfig, breach: Breach, breaches: readonly Breach[], covered: readonly number[]): number[] {
  const forbidden = forbiddenNear(cfg, breaches, breach.id);
  const own = new Set(breach.cells);
  const out = new Set<number>();
  for (const c of breach.cells) {
    for (const n of neighbours(cfg, c)) {
      if (own.has(n) || covered[n]! > 0 || forbidden[n]) continue;
      out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Deal breaches until `breachesAtOnce` are on the board. A breach is a union of one or more pentominoes
 * laid edge to edge, so a flawless is always possible in principle. It must sit on uncovered
 * hull at least one cell clear of every other breach. When nothing fits, fewer breaches are dealt and
 * the next move tries again.
 */
function spawnBreaches(
  cfg: PlatingConfig,
  breaches: readonly Breach[],
  covered: readonly number[],
  rng: PrngState,
  nextId: number,
): { breaches: Breach[]; added: Breach[]; rng: PrngState; nextId: number } {
  const out = breaches.slice();
  const added: Breach[] = [];
  while (out.length < cfg.breachesAtOnce) {
    const sizeRoll = nextInt(rng, cfg.maxBreachPieces - cfg.minBreachPieces + 1);
    rng = sizeRoll.state;
    const forbidden = forbiddenNear(cfg, out, null);
    const free = (c: number): boolean => !forbidden[c] && covered[c] === 0;
    let region: number[] | null = null;
    // Try the rolled size, then smaller ones, so a crowded hull still gets a breach if any pentomino fits.
    for (let size = cfg.minBreachPieces + sizeRoll.value; size >= 1 && region === null; size--) {
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
    const breach: Breach = { id: nextId++, cells: region, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true };
    out.push(breach);
    added.push(breach);
  }
  return { breaches: out, added, rng, nextId };
}

/** A uniformly random pentomino placement among those passing `accept`, or null when none does. */
function randomPlacement(cfg: PlatingConfig, rng: PrngState, accept: (cells: number[]) => boolean): { cells: number[] | null; rng: PrngState } {
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
