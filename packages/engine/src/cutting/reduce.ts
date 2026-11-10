import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_CUTTING_CONFIG,
  type CuttingBanked,
  type CuttingConfig,
  type CuttingGrade,
  type CuttingHalf,
  type CuttingMove,
  type CuttingMoveReport,
  type CuttingPiece,
  type CuttingPreview,
  type CuttingRect,
  type CuttingSlabReport,
  type CuttingState,
} from "./types.js";

/** A slab that cannot be made to bank anything is dealt again this many times before one is made by hand. */
const DEAL_TRIES = 40;

export function validateConfig(cfg: CuttingConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 2, 8) &&
    int(cfg.height, 2, 8) &&
    int(cfg.ores, 2, 8) &&
    int(cfg.partsStart, 2, cfg.width * cfg.height) &&
    int(cfg.partsMax, cfg.partsStart, cfg.width * cfg.height) &&
    int(cfg.flawsStart, 0, cfg.width * cfg.height) &&
    int(cfg.flawsMax, cfg.flawsStart, cfg.width * cfg.height) &&
    int(cfg.growEvery, 1, 1000) &&
    int(cfg.maxBlockPercent, 10, 100) &&
    int(cfg.budgetPercent, 1, 100) &&
    int(cfg.minCuts, 1, 12) &&
    int(cfg.maxCuts, cfg.minCuts, 12) &&
    int(cfg.cellPoints, 1, 1000) &&
    int(cfg.cleanPercent, 1, 100) &&
    int(cfg.cleanBonus, 0, 100_000) &&
    int(cfg.flawlessBonus, 0, 100_000) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid cutting config");
}

// ---- the best-value table

/**
 * For one slab: for every rectangle of it, the ore it is all of (if any), what an unlimited torch
 * could bank from it, and what the best plan banks from it with at most k cuts, for k up to the
 * most cuts a slab is ever given. Values are in cells squared; `cellPoints` is applied by callers.
 *
 * A pure rectangle is worth its area squared and wants no cut. Any other is worth the best split:
 * every cut line, and every way to share the remaining cuts between the two sides. Rectangles are
 * filled in from small to large, so both sides of every split are already known.
 */
interface Table {
  readonly width: number;
  readonly height: number;
  readonly maxCuts: number;
  /** The ore of a pure rectangle, or -1. */
  readonly ore: Int8Array;
  readonly free: Int32Array;
  /** Index = rectangle * (maxCuts + 1) + cuts. */
  readonly best: Int32Array;
}

function rectIndex(t: { width: number; height: number }, x: number, y: number, w: number, h: number): number {
  return ((x * t.height + y) * t.width + (w - 1)) * t.height + (h - 1);
}

function buildTable(width: number, height: number, ores: readonly number[], maxCuts: number): Table {
  const n = width * height * width * height;
  const t: Table = { width, height, maxCuts, ore: new Int8Array(n), free: new Int32Array(n), best: new Int32Array(n * (maxCuts + 1)) };
  const K = maxCuts + 1;
  for (let w = 1; w <= width; w++) {
    for (let h = 1; h <= height; h++) {
      for (let x = 0; x + w <= width; x++) {
        for (let y = 0; y + h <= height; y++) {
          const id = rectIndex(t, x, y, w, h);
          const first = ores[y * width + x]!;
          let pure = true;
          for (let yy = y; yy < y + h && pure; yy++) {
            for (let xx = x; xx < x + w; xx++) {
              if (ores[yy * width + xx] !== first) {
                pure = false;
                break;
              }
            }
          }
          t.ore[id] = pure ? first : -1;
          if (pure) {
            const value = w * h * w * h;
            t.free[id] = value;
            for (let k = 0; k <= maxCuts; k++) t.best[id * K + k] = value;
            continue;
          }
          let free = 0;
          for (let c = 1; c < w; c++) free = Math.max(free, t.free[rectIndex(t, x, y, c, h)]! + t.free[rectIndex(t, x + c, y, w - c, h)]!);
          for (let c = 1; c < h; c++) free = Math.max(free, t.free[rectIndex(t, x, y, w, c)]! + t.free[rectIndex(t, x, y + c, w, h - c)]!);
          t.free[id] = free;
          for (let k = 1; k <= maxCuts; k++) {
            let best = 0;
            for (let c = 1; c < w; c++) {
              const a = rectIndex(t, x, y, c, h) * K;
              const b = rectIndex(t, x + c, y, w - c, h) * K;
              for (let k1 = 0; k1 < k; k1++) best = Math.max(best, t.best[a + k1]! + t.best[b + (k - 1 - k1)]!);
            }
            for (let c = 1; c < h; c++) {
              const a = rectIndex(t, x, y, w, c) * K;
              const b = rectIndex(t, x, y + c, w, h - c) * K;
              for (let k1 = 0; k1 < k; k1++) best = Math.max(best, t.best[a + k1]! + t.best[b + (k - 1 - k1)]!);
            }
            t.best[id * K + k] = best;
          }
        }
      }
    }
  }
  return t;
}

/** The area of the largest pure rectangle on the slab, in cells. */
function largestBlock(t: Table): number {
  let best = 0;
  for (let w = 1; w <= t.width; w++) {
    for (let h = 1; h <= t.height; h++) {
      if (w * h <= best) continue;
      for (let x = 0; x + w <= t.width && w * h > best; x++) {
        for (let y = 0; y + h <= t.height; y++) {
          if (t.ore[rectIndex(t, x, y, w, h)] !== -1) {
            best = w * h;
            break;
          }
        }
      }
    }
  }
  return best;
}

function tableBest(t: Table, r: CuttingRect, cuts: number): number {
  return t.best[rectIndex(t, r.x, r.y, r.w, r.h) * (t.maxCuts + 1) + Math.max(0, Math.min(cuts, t.maxCuts))]!;
}

function tableOre(t: Table, r: CuttingRect): number {
  return t.ore[rectIndex(t, r.x, r.y, r.w, r.h)]!;
}

/** The best the pieces on a table can bank between them with `cuts` cuts, for every number of cuts up to it: index = cuts used at most. */
function tableShare(t: Table, pieces: readonly CuttingRect[], cuts: number): number[][] {
  // rows[i][k] = the best from the first i pieces with at most k cuts.
  const rows: number[][] = [new Array<number>(cuts + 1).fill(0)];
  for (const p of pieces) {
    const prev = rows[rows.length - 1]!;
    const next = new Array<number>(cuts + 1).fill(0);
    for (let k = 0; k <= cuts; k++) {
      for (let own = 0; own <= k; own++) next[k] = Math.max(next[k]!, prev[k - own]! + tableBest(t, p, own));
    }
    rows.push(next);
  }
  return rows;
}

// ---- queries the board asks

/** The two sides of a cut through `r`: left then right for a vertical cut, top then bottom otherwise. */
function split(r: CuttingRect, vertical: boolean, at: number): [CuttingRect, CuttingRect] {
  return vertical
    ? [
        { x: r.x, y: r.y, w: at - r.x, h: r.h },
        { x: at, y: r.y, w: r.x + r.w - at, h: r.h },
      ]
    : [
        { x: r.x, y: r.y, w: r.w, h: at - r.y },
        { x: r.x, y: at, w: r.w, h: r.y + r.h - at },
      ];
}

/** The ore a rectangle of the slab is all of, or null when it is mixed. */
export function pureOre(state: CuttingState, r: CuttingRect): number | null {
  const first = state.ores[r.y * state.config.width + r.x]!;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) if (state.ores[y * state.config.width + x] !== first) return null;
  }
  return first;
}

/** What a pure piece of this size banks. */
export function pieceValue(cfg: CuttingConfig, r: CuttingRect): number {
  return cfg.cellPoints * r.w * r.h * r.w * r.h;
}

/** The piece on the table that covers cell (x, y), or null when that cell has been banked or is off the slab. */
export function pieceAt(state: CuttingState, x: number, y: number): CuttingPiece | null {
  for (const p of state.pieces) if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return p;
  return null;
}

export function cutIllegalReason(state: CuttingState, pieceId: number, vertical: boolean, at: number): string | null {
  if (state.finished) return "game is finished";
  if (state.cutsLeft <= 0) return "no cuts left";
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) return "no such piece";
  if (typeof vertical !== "boolean") return "no direction";
  if (!Number.isInteger(at)) return "no such line";
  if (vertical ? at <= piece.x || at >= piece.x + piece.w : at <= piece.y || at >= piece.y + piece.h) return "the line is not inside the piece";
  return null;
}

/** What a cut would do, or null when it cannot be made. The board shows this while a cut is lined up; the reducer banks with the same sums. */
export function cutPreview(state: CuttingState, pieceId: number, vertical: boolean, at: number): CuttingPreview | null {
  if (cutIllegalReason(state, pieceId, vertical, at) !== null) return null;
  const piece = state.pieces.find((p) => p.id === pieceId)!;
  const [a, b] = split(piece, vertical, at);
  const side = (r: CuttingRect): CuttingPreview["halves"][number] => {
    const ore = pureOre(state, r);
    return { ...r, ore, points: ore === null ? 0 : pieceValue(state.config, r) };
  };
  const halves = [side(a), side(b)] as const;
  const line: CuttingPreview["line"] = vertical ? [at, piece.y, at, piece.y + piece.h] : [piece.x, at, piece.x + piece.w, at];
  return { line, halves, points: halves[0].points + halves[1].points };
}

/** What the streak multiplies a slab's bonus by, in percent, at a streak of `streak` slabs. */
export function streakPercentAt(cfg: CuttingConfig, streak: number): number {
  if (streak <= 0) return 100;
  return cfg.streakPercent[Math.min(streak, cfg.streakPercent.length) - 1]!;
}

/** How a slab that banked `got` of a best of `best` is graded. */
export function grade(cfg: CuttingConfig, got: number, best: number): CuttingGrade {
  if (got >= best) return "flawless";
  return got * 100 >= cfg.cleanPercent * best ? "clean" : "rough";
}

/** The best any plan can bank from a whole slab of these ores with `cuts` cuts, in points. */
export function slabBest(cfg: CuttingConfig, ores: readonly number[], cuts: number): number {
  const t = buildTable(cfg.width, cfg.height, ores, Math.max(0, cuts));
  return tableBest(t, { x: 0, y: 0, w: cfg.width, h: cfg.height }, cuts) * cfg.cellPoints;
}

/** The most the pieces still on the table can bank with the cuts that are left. Zero means the slab is over. */
export function bestRemaining(state: CuttingState): number {
  if (state.pieces.length === 0 || state.cutsLeft <= 0) return 0;
  const t = buildTable(state.config.width, state.config.height, state.ores, state.cutsLeft);
  const rows = tableShare(t, state.pieces, state.cutsLeft);
  return rows[rows.length - 1]![state.cutsLeft]! * state.config.cellPoints;
}

/**
 * The first cut of a best plan for what is on the table, or null when nothing more can be banked.
 * For the idle hint in practice, and for bots: following it cut after cut banks the slab's best.
 */
export function bestCut(state: CuttingState): { piece: number; vertical: boolean; at: number } | null {
  if (state.finished || state.pieces.length === 0 || state.cutsLeft <= 0) return null;
  const cuts = state.cutsLeft;
  const t = buildTable(state.config.width, state.config.height, state.ores, cuts);
  const rows = tableShare(t, state.pieces, cuts);
  if (rows[rows.length - 1]![cuts]! === 0) return null;
  // Walk the shares back to find how many cuts each piece gets in one best plan.
  const own = new Array<number>(state.pieces.length).fill(0);
  let k = cuts;
  for (let i = state.pieces.length - 1; i >= 0; i--) {
    const p = state.pieces[i]!;
    for (let give = 0; give <= k; give++) {
      if (rows[i]![k - give]! + tableBest(t, p, give) === rows[i + 1]![k]!) {
        own[i] = give;
        k -= give;
        break;
      }
    }
  }
  // The first piece whose share of cuts earns anything: the cut and split that reach its best.
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i]!;
    const give = own[i]!;
    const want = tableBest(t, p, give);
    if (give === 0 || want === 0) continue;
    for (const vertical of [true, false]) {
      const from = vertical ? p.x + 1 : p.y + 1;
      const to = vertical ? p.x + p.w : p.y + p.h;
      for (let at = from; at < to; at++) {
        const [a, b] = split(p, vertical, at);
        for (let k1 = 0; k1 < give; k1++) {
          if (tableBest(t, a, k1) + tableBest(t, b, give - 1 - k1) === want) return { piece: p.id, vertical, at };
        }
      }
    }
  }
  return null;
}

// ---- dealing

interface Dealt {
  ores: number[];
  cutsAllowed: number;
  /** In points. */
  best: number;
  rng: PrngState;
}

/** Blocks and flaws for the slab numbered `slab`: more of both as slabs are finished. */
export function slabShape(cfg: CuttingConfig, slab: number): { parts: number; flaws: number } {
  const level = Math.floor(slab / cfg.growEvery);
  return { parts: Math.min(cfg.partsMax, cfg.partsStart + level), flaws: Math.min(cfg.flawsMax, cfg.flawsStart + Math.floor(level / 2)) };
}

/**
 * Deal a slab: split the rectangle at random into blocks, a bigger block more likely to be split
 * and more often across its longer side; give each block an ore; then turn a few cells into flaws.
 * Blocks that share an ore run together, so the shapes on the slab are not all rectangles; a slab
 * where they run into one block bigger than `maxBlockPercent` of it is dealt again. The slab's cuts
 * are the fewest that let the best plan bank `budgetPercent` of what an unlimited torch could.
 */
function dealSlab(cfg: CuttingConfig, rngIn: PrngState, slab: number): Dealt {
  let rng = rngIn;
  const roll = (n: number): number => {
    const r = nextInt(rng, n);
    rng = r.state;
    return r.value;
  };
  const { width, height } = cfg;
  const { parts, flaws } = slabShape(cfg, slab);
  const whole: CuttingRect = { x: 0, y: 0, w: width, h: height };
  for (let attempt = 0; attempt < DEAL_TRIES; attempt++) {
    const blocks: CuttingRect[] = [whole];
    while (blocks.length < parts) {
      const splittable = blocks.filter((b) => b.w > 1 || b.h > 1);
      if (splittable.length === 0) break;
      let pick = roll(splittable.reduce((sum, b) => sum + b.w * b.h, 0));
      let block = splittable[0]!;
      for (const b of splittable) {
        if (pick < b.w * b.h) {
          block = b;
          break;
        }
        pick -= b.w * b.h;
      }
      const vertical = block.w > 1 && block.h > 1 ? roll(block.w + block.h) < block.w : block.w > 1;
      const at = vertical ? block.x + 1 + roll(block.w - 1) : block.y + 1 + roll(block.h - 1);
      blocks.splice(blocks.indexOf(block), 1, ...split(block, vertical, at));
    }
    const ores = new Array<number>(width * height).fill(0);
    for (const b of blocks) {
      const ore = roll(cfg.ores);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) ores[y * width + x] = ore;
    }
    for (let i = 0; i < flaws; i++) {
      const cell = roll(width * height);
      ores[cell] = (ores[cell]! + 1 + roll(cfg.ores - 1)) % cfg.ores;
    }
    const t = buildTable(width, height, ores, cfg.maxCuts);
    // A slab of one ore asks nothing; neither does one no plan can bank from. One huge block is a windfall.
    if (tableOre(t, whole) !== -1) continue;
    if (largestBlock(t) * 100 > cfg.maxBlockPercent * width * height) continue;
    const free = t.free[rectIndex(t, 0, 0, width, height)]!;
    let cuts = cfg.minCuts;
    while (cuts < cfg.maxCuts && tableBest(t, whole, cuts) * 100 < cfg.budgetPercent * free) cuts++;
    const best = tableBest(t, whole, cuts);
    if (best > 0) return { ores, cutsAllowed: cuts, best: best * cfg.cellPoints, rng };
  }
  // No deal worked (a tiny board, or a config at its limits): two halves of two ores, one cut apart.
  const ores = new Array<number>(width * height).fill(0);
  const half = Math.floor(width / 2);
  for (let y = 0; y < height; y++) for (let x = half; x < width; x++) ores[y * width + x] = 1;
  const t = buildTable(width, height, ores, cfg.maxCuts);
  return { ores, cutsAllowed: cfg.minCuts, best: tableBest(t, whole, cfg.minCuts) * cfg.cellPoints, rng };
}

export function createCuttingGame(seed: string, config: CuttingConfig = DEFAULT_CUTTING_CONFIG): CuttingState {
  validateConfig(config);
  const dealt = dealSlab(config, seedFromString(`cutting:${seed}`), 0);
  return {
    config,
    ores: dealt.ores,
    pieces: [{ id: 1, x: 0, y: 0, w: config.width, h: config.height }],
    banked: [],
    slab: 0,
    cutsAllowed: dealt.cutsAllowed,
    cutsLeft: dealt.cutsAllowed,
    slabGot: 0,
    slabBest: dealt.best,
    rng: dealt.rng,
    nextId: 2,
    score: 0,
    moveCount: 0,
    logLength: 0,
    combo: 0,
    bestCombo: 0,
    slabsDone: 0,
    flawless: 0,
    clean: 0,
    rough: 0,
    totalGot: 0,
    totalBest: 0,
    biggest: 0,
    lastMove: null,
    finished: false,
  };
}

// ---- the reducer

export function reduceCutting(state: CuttingState, move: CuttingMove): CuttingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, logLength: state.logLength + 1, lastMove: null, finished: true };
    case "done":
      return finishSlab(state, move, null, "done");
    case "cut":
      return cut(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function cut(state: CuttingState, move: Extract<CuttingMove, { type: "cut" }>): CuttingState {
  const cfg = state.config;
  const reason = cutIllegalReason(state, move.piece, move.vertical, move.at);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const piece = state.pieces.find((p) => p.id === move.piece)!;
  const [ra, rb] = split(piece, move.vertical, move.at);
  let nextId = state.nextId;
  const side = (r: CuttingRect): CuttingHalf => {
    const ore = pureOre(state, r);
    return { piece: { id: nextId++, ...r }, ore, points: ore === null ? 0 : pieceValue(cfg, r) };
  };
  const halves: [CuttingHalf, CuttingHalf] = [side(ra), side(rb)];
  const pieces = state.pieces.filter((p) => p.id !== piece.id);
  const banked: CuttingBanked[] = state.banked.slice();
  let biggest = state.biggest;
  for (const h of halves) {
    if (h.ore === null) pieces.push(h.piece);
    else {
      banked.push({ ...h.piece, ore: h.ore, points: h.points });
      biggest = Math.max(biggest, h.piece.w * h.piece.h);
    }
  }
  const points = halves[0].points + halves[1].points;
  const after: CuttingState = {
    ...state,
    pieces,
    banked,
    cutsLeft: state.cutsLeft - 1,
    slabGot: state.slabGot + points,
    nextId,
    score: state.score + points,
    moveCount: state.moveCount + 1,
    biggest,
  };
  const report = { piece, vertical: move.vertical, at: move.at, halves } as const;
  // The slab is over when the table is bare, the cuts are spent, or no cut left could bank anything.
  const over = pieces.length === 0 ? "clear" : after.cutsLeft === 0 ? "cuts" : bestRemaining(after) === 0 ? "stuck" : null;
  if (over !== null) return finishSlab(after, move, report, over, points);
  const logLength = state.logLength + 1;
  return { ...after, logLength, lastMove: { move, cut: report, slab: null, points }, finished: logLength >= cfg.maxMoves };
}

/** Grade the slab on the table as it stands, pay its bonus and deal the next one. */
function finishSlab(state: CuttingState, move: CuttingMove, cutReport: CuttingMoveReport["cut"], reason: CuttingSlabReport["reason"], cutPoints = 0): CuttingState {
  const cfg = state.config;
  const g = grade(cfg, state.slabGot, state.slabBest);
  const combo = g === "rough" ? 0 : state.combo + 1;
  const percent = streakPercentAt(cfg, combo);
  const base = g === "flawless" ? cfg.flawlessBonus : g === "clean" ? cfg.cleanBonus : 0;
  const bonus = Math.floor((base * percent) / 100);
  const slab: CuttingSlabReport = { reason, got: state.slabGot, best: state.slabBest, grade: g, bonus, streak: combo, streakPercent: percent, scrap: state.pieces, cutsLeft: state.cutsLeft };
  const next = state.slab + 1;
  const dealt = dealSlab(cfg, state.rng, next);
  const logLength = state.logLength + 1;
  return {
    ...state,
    ores: dealt.ores,
    pieces: [{ id: state.nextId, x: 0, y: 0, w: cfg.width, h: cfg.height }],
    banked: [],
    slab: next,
    cutsAllowed: dealt.cutsAllowed,
    cutsLeft: dealt.cutsAllowed,
    slabGot: 0,
    slabBest: dealt.best,
    rng: dealt.rng,
    nextId: state.nextId + 1,
    score: state.score + bonus,
    logLength,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    slabsDone: state.slabsDone + 1,
    flawless: state.flawless + (g === "flawless" ? 1 : 0),
    clean: state.clean + (g === "clean" ? 1 : 0),
    rough: state.rough + (g === "rough" ? 1 : 0),
    totalGot: state.totalGot + state.slabGot,
    totalBest: state.totalBest + state.slabBest,
    lastMove: { move, cut: cutReport, slab, points: cutPoints + bonus },
    finished: logLength >= cfg.maxMoves,
  };
}

export function hashCuttingState(state: CuttingState): string {
  const h = new Hasher();
  h.int(state.ores.length);
  for (const o of state.ores) h.int(o);
  h.int(state.pieces.length);
  for (const p of state.pieces) h.int(p.id).int(p.x).int(p.y).int(p.w).int(p.h);
  h.int(state.banked.length);
  for (const b of state.banked) h.int(b.id).int(b.x).int(b.y).int(b.w).int(b.h).int(b.ore).int(b.points);
  h.int(state.slab).int(state.cutsAllowed).int(state.cutsLeft).int(state.slabGot).int(state.slabBest);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.logLength).int(state.combo).int(state.bestCombo);
  h.int(state.slabsDone).int(state.flawless).int(state.clean).int(state.rough).int(state.totalGot).int(state.totalBest).int(state.biggest);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface CuttingSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeCutting(state: CuttingState): CuttingSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The table as text: a character a cell, row by row (the ore's digit while the cell is on a piece,
 * `.` once it has been banked), then `;` and every piece as `x.y.w.h`, top to bottom and left to
 * right. What the board draws must match it.
 */
export function viewString(ores: readonly number[], width: number, pieces: readonly CuttingRect[]): string {
  const cells = new Array<string>(ores.length).fill(".");
  for (const p of pieces) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) cells[y * width + x] = String(ores[y * width + x]);
  }
  const rects = pieces
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p) => `${p.x}.${p.y}.${p.w}.${p.h}`);
  return `${cells.join("")};${rects.join(",")}`;
}
