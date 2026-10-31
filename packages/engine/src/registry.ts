/**
 * One entry per puzzle so the server, the client round runner, and the tests can drive any engine
 * without knowing its shapes. Each engine stays its own strongly typed module; this is the seam.
 */
import {
  DEFAULT_BILGING_CONFIG,
  createBilgingGame,
  hashBilgingState,
  reduceBilging,
  summarizeBilging,
  validateBilgingConfig,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
} from "./bilging/index.js";
import {
  DEFAULT_CARPENTRY_CONFIG,
  createCarpentryGame,
  hashCarpentryState,
  reduceCarpentry,
  summarizeCarpentry,
  validateCarpentryConfig,
  type CarpentryConfig,
  type CarpentryMove,
  type CarpentryState,
} from "./carpentry/index.js";
import {
  DEFAULT_SAILING_CONFIG,
  createSailingGame,
  hashSailingState,
  reduceSailing,
  summarizeSailing,
  validateSailingConfig,
  type SailingConfig,
  type SailingMove,
  type SailingState,
} from "./sailing/index.js";

/** Every puzzle the engine knows about. Extended one at a time per the milestone ladder. */
export const PUZZLE_IDS = ["bilging", "sailing", "carpentry"] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];

/** What every finished round reports. The database row and the result message share this shape. */
export interface PuzzleSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export interface PuzzleDef<S, M, C> {
  readonly id: PuzzleId;
  readonly defaultConfig: C;
  validateConfig(config: C): void;
  create(seed: string, config: C): S;
  /** Throws InvalidMoveError on an illegal move. Never mutates `state`. */
  reduce(state: S, move: M): S;
  hash(state: S): string;
  summarize(state: S): PuzzleSummary;
  isFinished(state: S): boolean;
  /** The longest move log the server accepts for this config. */
  maxMoves(config: C): number;
  /**
   * For engines whose moves carry their own clock (ticks): the ms since round start this move
   * claims to happen at. The server rejects claims ahead of the wall clock. Undefined when moves
   * are untimed.
   */
  moveTimeMs?(move: M, config: C): number;
}

export const BILGING_DEF: PuzzleDef<BilgingState, BilgingMove, BilgingConfig> = {
  id: "bilging",
  defaultConfig: DEFAULT_BILGING_CONFIG,
  validateConfig: validateBilgingConfig,
  create: createBilgingGame,
  reduce: reduceBilging,
  hash: hashBilgingState,
  summarize: summarizeBilging,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};

export const SAILING_DEF: PuzzleDef<SailingState, SailingMove, SailingConfig> = {
  id: "sailing",
  defaultConfig: DEFAULT_SAILING_CONFIG,
  validateConfig: validateSailingConfig,
  create: createSailingGame,
  reduce: reduceSailing,
  hash: hashSailingState,
  summarize: summarizeSailing,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};

export const CARPENTRY_DEF: PuzzleDef<CarpentryState, CarpentryMove, CarpentryConfig> = {
  id: "carpentry",
  defaultConfig: DEFAULT_CARPENTRY_CONFIG,
  validateConfig: validateCarpentryConfig,
  create: createCarpentryGame,
  reduce: reduceCarpentry,
  hash: hashCarpentryState,
  summarize: summarizeCarpentry,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};

/** The engine behind each puzzle id, erased to `unknown` shapes for generic drivers. */
export type AnyPuzzleDef = PuzzleDef<unknown, unknown, unknown>;

export const PUZZLES: Readonly<Record<PuzzleId, AnyPuzzleDef>> = {
  bilging: BILGING_DEF as unknown as AnyPuzzleDef,
  sailing: SAILING_DEF as unknown as AnyPuzzleDef,
  carpentry: CARPENTRY_DEF as unknown as AnyPuzzleDef,
};

export function isPuzzleId(x: unknown): x is PuzzleId {
  return typeof x === "string" && (PUZZLE_IDS as readonly string[]).includes(x);
}
