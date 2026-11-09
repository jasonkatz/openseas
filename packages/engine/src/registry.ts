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
  DEFAULT_COOLING_CONFIG,
  SHIP_HEAT_EVENTS_MAX,
  createCoolingGame,
  hashCoolingState,
  reduceCooling,
  summarizeCooling,
  validateCoolingConfig,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
} from "./cooling/index.js";
import {
  DEFAULT_PLATING_CONFIG,
  createPlatingGame,
  hashPlatingState,
  reducePlating,
  summarizePlating,
  validatePlatingConfig,
  type PlatingConfig,
  type PlatingMove,
  type PlatingState,
} from "./plating/index.js";
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
  DEFAULT_ENGINES_CONFIG,
  createEnginesGame,
  hashEnginesState,
  reduceEngines,
  summarizeEngines,
  validateEnginesConfig,
  type EnginesConfig,
  type EnginesMove,
  type EnginesState,
} from "./engines/index.js";
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
export const PUZZLE_IDS = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight"] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];
/** The duty puzzles: the ones a station aboard a ship plays. Space Battle is the captain's game, not a station. */
export const DUTY_PUZZLE_IDS = ["cooling", "engines", "plating", "gunnery", "navigation"] as const;
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

export const COOLING_DEF: PuzzleDef<CoolingState, CoolingMove, CoolingConfig> = {
  id: "cooling",
  defaultConfig: DEFAULT_COOLING_CONFIG,
  validateConfig: validateCoolingConfig,
  create: createCoolingGame,
  reduce: reduceCooling,
  hash: hashCoolingState,
  summarize: summarizeCooling,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + (c.shipHeat ? SHIP_HEAT_EVENTS_MAX : 0),
};

export const ENGINES_DEF: PuzzleDef<EnginesState, EnginesMove, EnginesConfig> = {
  id: "engines",
  defaultConfig: DEFAULT_ENGINES_CONFIG,
  validateConfig: validateEnginesConfig,
  create: createEnginesGame,
  reduce: reduceEngines,
  hash: hashEnginesState,
  summarize: summarizeEngines,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};

export const PLATING_DEF: PuzzleDef<PlatingState, PlatingMove, PlatingConfig> = {
  id: "plating",
  defaultConfig: DEFAULT_PLATING_CONFIG,
  validateConfig: validatePlatingConfig,
  create: createPlatingGame,
  reduce: reducePlating,
  hash: hashPlatingState,
  summarize: summarizePlating,
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
  cooling: COOLING_DEF as unknown as AnyPuzzleDef,
  engines: ENGINES_DEF as unknown as AnyPuzzleDef,
  plating: PLATING_DEF as unknown as AnyPuzzleDef,
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
