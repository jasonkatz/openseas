import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { seedFromString, type PrngState } from "../prng.js";
import { colOf, findMatches, groupPoints, idx, rowOf } from "./board.js";
import { generateBoard, spawnPiece } from "./generate.js";
import {
  DEFAULT_BILGING_CONFIG,
  Special,
  isSpecial,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
  type ClearRound,
  type ClearedGroup,
  type MoveReport,
  type Piece,
} from "./types.js";

const BARNACLE_POINTS = 15;

export function createBilgingGame(seed: string, config: BilgingConfig = DEFAULT_BILGING_CONFIG): BilgingState {
  validateConfig(config);
  const g = generateBoard(config, seedFromString(`bilging:${seed}`));
  return {
    config,
    cells: g.cells,
    rng: g.rng,
    nextId: g.nextId,
    moveCount: 0,
    score: 0,
    water: config.initialWaterRow * waterUnitsPerRow(config),
    waterRow: config.initialWaterRow,
    combo: 0,
    misses: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

export function validateConfig(cfg: BilgingConfig): void {
  const ok =
    Number.isInteger(cfg.width) &&
    cfg.width >= 3 &&
    Number.isInteger(cfg.height) &&
    cfg.height >= 3 &&
    Number.isInteger(cfg.pieceKinds) &&
    cfg.pieceKinds >= 3 &&
    cfg.pieceKinds <= 12 &&
    Number.isInteger(cfg.waterRisePerMoves) &&
    cfg.waterRisePerMoves > 0 &&
    Number.isInteger(cfg.waterDropPerPoints) &&
    cfg.waterDropPerPoints > 0 &&
    Number.isInteger(cfg.minWaterRow) &&
    cfg.minWaterRow >= 0 &&
    cfg.minWaterRow <= cfg.initialWaterRow &&
    cfg.initialWaterRow <= cfg.height &&
    cfg.maxMoves > 0 &&
    typeof cfg.shipWater === "boolean" &&
    Array.isArray(cfg.cascadeMultipliers) &&
    cfg.cascadeMultipliers.length >= 1 &&
    cfg.cascadeMultipliers.length <= 16 &&
    cfg.cascadeMultipliers.every((m) => Number.isInteger(m) && m >= 1 && m <= 100) &&
    Number.isInteger(cfg.streakStepPercent) &&
    cfg.streakStepPercent >= 0 &&
    Number.isInteger(cfg.streakMaxPercent) &&
    cfg.streakMaxPercent >= 100 &&
    cfg.streakMaxPercent <= 1000 &&
    Number.isInteger(cfg.streakGrace) &&
    cfg.streakGrace >= 0;
  if (!ok) throw new Error("invalid bilging config");
}

export function waterUnitsPerRow(cfg: BilgingConfig): number {
  return cfg.waterRisePerMoves * cfg.waterDropPerPoints;
}

/**
 * The water after one move that scored `points`: it rises by 1/waterRisePerMoves of a row and
 * drains a row per waterDropPerPoints points, then settles between the floor and the top.
 */
export function waterAfterMove(cfg: BilgingConfig, water: number, points: number): number {
  // Aboard a ship the bilge is the ship's; a swap leaves it where the last water event put it.
  if (cfg.shipWater) return water;
  const per = waterUnitsPerRow(cfg);
  const next = water + cfg.waterDropPerPoints - points * cfg.waterRisePerMoves;
  return Math.max(cfg.minWaterRow * per, Math.min(cfg.height * per, next));
}

export function waterRowOf(cfg: BilgingConfig, water: number): number {
  return Math.floor(water / waterUnitsPerRow(cfg));
}

export function reduceBilging(state: BilgingState, move: BilgingMove): BilgingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "water":
      return applyWater(state, move);
    case "end":
      return { ...state, finished: true, lastMove: { move, rounds: [], points: 0, streakPercent: 100 } };
    case "swap":
      return applySwap(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

/** Replay a whole move log from a seed. Throws InvalidMoveError on the first illegal move. */
export function replayBilging(
  seed: string,
  moves: readonly BilgingMove[],
  config: BilgingConfig = DEFAULT_BILGING_CONFIG,
): BilgingState {
  let s = createBilgingGame(seed, config);
  for (const m of moves) s = reduceBilging(s, m);
  return s;
}

/** Fingerprint of everything that matters for divergence detection. */
export function hashBilgingState(state: BilgingState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height).int(state.config.pieceKinds);
  for (const p of state.cells) h.int(p.id).int(p.kind);
  h.int(state.nextId).int(state.moveCount).int(state.score).int(state.water).int(state.waterRow).int(state.combo).int(state.misses);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface SwapPreview {
  readonly legal: boolean;
  /** Cells that would clear immediately (before cascades). Empty for a plain swap. */
  readonly cells: readonly number[];
}

/** What a swap would do, without advancing the game. Drives the match preview on hover or hold. */
export function previewSwap(state: BilgingState, col: number, row: number): SwapPreview {
  const reason = swapIllegalReason(state, col, row);
  if (reason !== null) return { legal: false, cells: [] };
  const cells = state.cells.slice();
  const i = idx(state.config, col, row);
  const j = i + 1;
  [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  const groups = immediateClears(state.config, cells, i, j);
  const set = new Set<number>();
  for (const g of groups) for (const c of g.cells) set.add(c);
  return { legal: true, cells: [...set].sort((a, b) => a - b) };
}

export function swapIllegalReason(state: BilgingState, col: number, row: number): string | null {
  const { width, height } = state.config;
  if (state.finished) return "game is finished";
  if (!Number.isInteger(col) || !Number.isInteger(row)) return "non-integer coordinates";
  if (col < 0 || col >= width - 1 || row < 0 || row >= height) return "out of bounds";
  const a = state.cells[idx(state.config, col, row)]!;
  const b = state.cells[idx(state.config, col + 1, row)]!;
  void a;
  void b;
  return null;
}

/** The ship's water, as the ship's turn reported it. Counts as no move: the combo, the clock and the move cap are untouched. */
function applyWater(state: BilgingState, move: Extract<BilgingMove, { type: "water" }>): BilgingState {
  const cfg = state.config;
  if (!cfg.shipWater) throw new InvalidMoveError("the board keeps its own water", move);
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (!Number.isInteger(move.row) || move.row < 0 || move.row > cfg.height) throw new InvalidMoveError("water row out of range", move);
  const water = move.row * waterUnitsPerRow(cfg);
  return { ...state, water, waterRow: move.row, lastMove: { move, rounds: [], points: 0, streakPercent: 100 } };
}

/** Water events the ship may inject over a board's life, on top of the swaps the cap allows. */
export const SHIP_WATER_EVENTS_MAX = 64;

function applySwap(state: BilgingState, move: Extract<BilgingMove, { type: "swap" }>): BilgingState {
  const reason = swapIllegalReason(state, move.col, move.row);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cfg = state.config;
  const i = idx(cfg, move.col, move.row);
  const j = i + 1;

  const cells: Array<Piece | null> = state.cells.slice();
  [cells[i], cells[j]] = [cells[j]!, cells[i]!];

  let rng = state.rng;
  let nextId = state.nextId;
  const rounds: ClearRound[] = [];
  let chain = 1;

  const moveCount = state.moveCount + 1;
  // The streak multiplier this move scores at, should it score at all.
  const streak = Math.min(cfg.streakMaxPercent, 100 + cfg.streakStepPercent * state.combo);
  const withStreak = (raw: number): number => (raw > 0 ? Math.floor((raw * streak) / 100) : 0);
  const cascade = (step: number): number => cfg.cascadeMultipliers[Math.min(step, cfg.cascadeMultipliers.length) - 1]!;
  let groups = immediateClears(cfg, cells, i, j);
  const settle = (): void => {
    while (groups.length > 0) {
      const base = groups.reduce((sum, g) => sum + g.points, 0);
      // Barnacles coming off are worth what lifting several together set up, not the cascade's luck.
      const lifted = groups.every((g) => g.cause === "barnacle");
      const points = base * groups.length * (lifted ? 1 : cascade(chain));
      for (const g of groups) for (const c of g.cells) cells[c] = null;
      const r = riseAndRefill(cfg, cells, rng, nextId);
      rng = r.rng;
      nextId = r.nextId;
      rounds.push({ chain, groups, points, settled: cells.slice() as Piece[] });
      chain++;
      groups = matchGroups(cfg, cells);
    }
  };
  settle();

  // Barnacles that the board has lifted to or above the water line come off, and the board settles
  // again. That settling can lift further barnacles (or the bonus can drain the water past one), so
  // repeat until none is left above the line: a move never ends with a barnacle that should be off.
  for (;;) {
    const pointsSoFar = withStreak(rounds.reduce((sum, r) => sum + r.points, 0));
    groups = surfacedBarnacles(cfg, cells, waterRowOf(cfg, waterAfterMove(cfg, state.water, pointsSoFar)));
    if (groups.length === 0) break;
    settle();
  }

  const raw = rounds.reduce((sum, r) => sum + r.points, 0);
  const points = withStreak(raw);
  const score = state.score + points;
  // A setup swap or two (up to the grace) keeps the streak; one more breaks it.
  const misses = raw > 0 ? 0 : state.misses + 1;
  const combo = raw > 0 ? state.combo + 1 : misses > cfg.streakGrace ? 0 : state.combo;
  const water = waterAfterMove(cfg, state.water, points);
  const report: MoveReport = { move, rounds, points, streakPercent: raw > 0 ? streak : 100 };
  return {
    config: cfg,
    cells: cells as Piece[],
    rng,
    nextId,
    moveCount,
    score,
    water,
    waterRow: waterRowOf(cfg, water),
    combo,
    misses,
    bestCombo: Math.max(state.bestCombo, combo),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

function matchGroups(cfg: BilgingConfig, cells: ReadonlyArray<Piece | null>): ClearedGroup[] {
  return findMatches(cfg, cells).map((g) => ({ cells: g, ids: idsAt(cells, g), points: groupPoints(g.length), cause: "match" }));
}

function idsAt(cells: ReadonlyArray<Piece | null>, at: readonly number[]): number[] {
  return at.map((c) => cells[c]!.id);
}

/**
 * Everything the swap itself clears: special-piece effects for the two swapped cells plus any
 * ordinary runs now present on the board. Cells claimed by a special are not counted twice.
 */
function immediateClears(cfg: BilgingConfig, cells: ReadonlyArray<Piece | null>, i: number, j: number): ClearedGroup[] {
  const groups: ClearedGroup[] = [];
  const claimed = new Set<number>();
  const claim = (set: Iterable<number>): number[] => {
    const out: number[] = [];
    for (const c of set) {
      if (claimed.has(c)) continue;
      claimed.add(c);
      out.push(c);
    }
    return out.sort((a, b) => a - b);
  };

  const a = cells[i]!;
  const b = cells[j]!;
  const swapped: Array<[number, Piece, Piece]> = [
    [i, a, b],
    [j, b, a],
  ];

  // Kegs detonate in a 3x3 around where they landed.
  for (const [pos, piece] of swapped) {
    if (piece.kind !== Special.Keg) continue;
    const col = colOf(cfg, pos);
    const row = rowOf(cfg, pos);
    const blast: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= cfg.width || r < 0 || r >= cfg.height) continue;
        blast.push(idx(cfg, c, r));
      }
    }
    const c = claim(blast);
    if (c.length) groups.push({ cells: c, ids: idsAt(cells, c), points: c.length, cause: "keg" });
  }
  // Ink clouds wipe every piece of the kind they were swapped with.
  for (const [pos, piece, other] of swapped) {
    if (piece.kind !== Special.Ink) continue;
    const wipe: number[] = [pos];
    if (!isSpecial(other.kind)) {
      for (let k = 0; k < cells.length; k++) if (cells[k]?.kind === other.kind) wipe.push(k);
    }
    const c = claim(wipe);
    if (c.length) groups.push({ cells: c, ids: idsAt(cells, c), points: c.length * 2, cause: "ink" });
  }
  // Ordinary runs, minus anything a special already took.
  for (const g of findMatches(cfg, cells)) {
    const c = claim(g);
    if (c.length >= 3) groups.push({ cells: c, ids: idsAt(cells, c), points: groupPoints(c.length), cause: "match" });
    else if (c.length > 0) groups.push({ cells: c, ids: idsAt(cells, c), points: c.length, cause: "match" });
  }
  return groups;
}

/**
 * The bilge fills from below: pieces float up into empty cells column by column and new pieces
 * enter from the bottom, out of the water.
 */
function riseAndRefill(
  cfg: BilgingConfig,
  cells: Array<Piece | null>,
  rng: PrngState,
  nextId: number,
): { rng: PrngState; nextId: number } {
  for (let c = 0; c < cfg.width; c++) {
    let write = cfg.height - 1;
    for (let r = cfg.height - 1; r >= 0; r--) {
      const p = cells[idx(cfg, c, r)];
      if (p !== null && p !== undefined) {
        cells[idx(cfg, c, write)] = p;
        write--;
      }
    }
    for (let r = write; r >= 0; r--) {
      const s = spawnPiece(cfg, rng, nextId);
      rng = s.rng;
      nextId = s.nextId;
      cells[idx(cfg, c, r)] = s.piece;
    }
  }
  return { rng, nextId };
}

/** Barnacles at or above the water line come off the hull. One group per barnacle. */
function surfacedBarnacles(cfg: BilgingConfig, cells: ReadonlyArray<Piece | null>, waterRow: number): ClearedGroup[] {
  const groups: ClearedGroup[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]?.kind === Special.Barnacle && rowOf(cfg, i) >= waterRow) {
      groups.push({ cells: [i], ids: [cells[i]!.id], points: BARNACLE_POINTS, cause: "barnacle" });
    }
  }
  return groups;
}

export interface BilgingSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeBilging(state: BilgingState): BilgingSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}
