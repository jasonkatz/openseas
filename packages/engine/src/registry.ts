/**
 * One entry per puzzle so the server, the client round runner, and the tests can drive any engine
 * without knowing its shapes. Each engine stays its own strongly typed module; this is the seam.
 */
import {
  DEFAULT_BATTLE_CONFIG,
  createBattleGame,
  hashBattleState,
  reduceBattle,
  summarizeBattle,
  validateBattleConfig,
  type BattleConfig,
  type BattleMove,
  type BattleState,
} from "./battle/index.js";
import {
  DEFAULT_BILGING_CONFIG,
  SHIP_WATER_EVENTS_MAX,
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
  DEFAULT_NAVIGATION_CONFIG,
  createNavigationGame,
  hashNavigationState,
  reduceNavigation,
  summarizeNavigation,
  validateNavigationConfig,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
} from "./navigation/index.js";
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
import {
  DEFAULT_SWORDFIGHT_CONFIG,
  createSwordfightGame,
  hashSwordfightState,
  reduceSwordfight,
  summarizeSwordfight,
  validateSwordfightConfig,
  type SwordfightConfig,
  type SwordfightMove,
  type SwordfightState,
} from "./swordfight/index.js";
import {
  DEFAULT_GUNNERY_CONFIG,
  createGunneryGame,
  hashGunneryState,
  reduceGunnery,
  summarizeGunnery,
  validateGunneryConfig,
  type GunneryConfig,
  type GunneryMove,
  type GunneryState,
} from "./gunnery/index.js";

/** Every puzzle the engine knows about. Extended one at a time per the milestone ladder. */
export const PUZZLE_IDS = ["bilging", "sailing", "carpentry", "gunnery", "navigation", "battle", "swordfight"] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];
/** The duty puzzles: the ones a station aboard a ship plays. Sea Battle is the captain's game, not a station. */
export const DUTY_PUZZLE_IDS = ["bilging", "sailing", "carpentry", "gunnery", "navigation"] as const;
export type DutyPuzzleId = (typeof DUTY_PUZZLE_IDS)[number];

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
  maxMoves: (c) => c.maxMoves + (c.shipWater ? SHIP_WATER_EVENTS_MAX : 0),
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

export const NAVIGATION_DEF: PuzzleDef<NavigationState, NavigationMove, NavigationConfig> = {
  id: "navigation",
  defaultConfig: DEFAULT_NAVIGATION_CONFIG,
  validateConfig: validateNavigationConfig,
  create: createNavigationGame,
  reduce: reduceNavigation,
  hash: hashNavigationState,
  summarize: summarizeNavigation,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => m.tick * c.tickMs,
};

export const GUNNERY_DEF: PuzzleDef<GunneryState, GunneryMove, GunneryConfig> = {
  id: "gunnery",
  defaultConfig: DEFAULT_GUNNERY_CONFIG,
  validateConfig: validateGunneryConfig,
  create: createGunneryGame,
  reduce: reduceGunnery,
  hash: hashGunneryState,
  summarize: summarizeGunnery,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => m.tick * c.tickMs,
};
export const BATTLE_DEF: PuzzleDef<BattleState, BattleMove, BattleConfig> = {
  id: "battle",
  defaultConfig: DEFAULT_BATTLE_CONFIG,
  validateConfig: validateBattleConfig,
  create: createBattleGame,
  reduce: reduceBattle,
  hash: hashBattleState,
  summarize: summarizeBattle,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};

export const SWORDFIGHT_DEF: PuzzleDef<SwordfightState, SwordfightMove, SwordfightConfig> = {
  id: "swordfight",
  defaultConfig: DEFAULT_SWORDFIGHT_CONFIG,
  validateConfig: validateSwordfightConfig,
  create: createSwordfightGame,
  reduce: reduceSwordfight,
  hash: hashSwordfightState,
  summarize: summarizeSwordfight,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => m.tick * c.tickMs,
};

/** The engine behind each puzzle id, erased to `unknown` shapes for generic drivers. */
export type AnyPuzzleDef = PuzzleDef<unknown, unknown, unknown>;

export const PUZZLES: Readonly<Record<PuzzleId, AnyPuzzleDef>> = {
  bilging: BILGING_DEF as unknown as AnyPuzzleDef,
  sailing: SAILING_DEF as unknown as AnyPuzzleDef,
  carpentry: CARPENTRY_DEF as unknown as AnyPuzzleDef,
  gunnery: GUNNERY_DEF as unknown as AnyPuzzleDef,
  navigation: NAVIGATION_DEF as unknown as AnyPuzzleDef,
  battle: BATTLE_DEF as unknown as AnyPuzzleDef,
  swordfight: SWORDFIGHT_DEF as unknown as AnyPuzzleDef,
};

export function isPuzzleId(x: unknown): x is PuzzleId {
  return typeof x === "string" && (PUZZLE_IDS as readonly string[]).includes(x);
}

export function isDutyPuzzleId(x: unknown): x is DutyPuzzleId {
  return typeof x === "string" && (DUTY_PUZZLE_IDS as readonly string[]).includes(x);
}
