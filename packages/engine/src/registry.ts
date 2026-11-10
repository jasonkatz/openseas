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

import type { PuzzleDef } from "./def.js";
import { SALVAGE_DEF } from "./salvage/index.js";
import { OVERLOAD_DEF } from "./overload/index.js";
import { DEFLECTORS_DEF } from "./deflectors/index.js";
import { REACTOR_DEF } from "./reactor/index.js";
import { SCANNER_DEF } from "./scanner/index.js";
import { TUG_DEF } from "./tug/index.js";
import { RACKS_DEF } from "./racks/index.js";
import { CUTTING_DEF } from "./cutting/index.js";

export type { PuzzleDef, PuzzleSummary } from "./def.js";

/** The game's own puzzles: the ones a ship or a fight deals. Extended one at a time per the milestone ladder. */
export const CORE_PUZZLE_IDS = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight"] as const;
export type CorePuzzleId = (typeof CORE_PUZZLE_IDS)[number];
/**
 * Prototype puzzles (ADR 0036): whole engines the server verifies like any other, dealt only on the
 * harness. Nothing in the game deals one until it is promoted, which is a decision of its own.
 */
export const PROTOTYPE_PUZZLE_IDS = ["salvage", "overload", "deflectors", "reactor", "scanner", "tug", "racks", "cutting"] as const;
export type PrototypePuzzleId = (typeof PROTOTYPE_PUZZLE_IDS)[number];
/** Every puzzle the engine knows about. */
export const PUZZLE_IDS = [...CORE_PUZZLE_IDS, ...PROTOTYPE_PUZZLE_IDS] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];
/** The duty puzzles: the ones a station aboard a ship plays. Space Battle is the captain's game, not a station. */
export const DUTY_PUZZLE_IDS = ["cooling", "engines", "plating", "gunnery", "navigation"] as const;
export type DutyPuzzleId = (typeof DUTY_PUZZLE_IDS)[number];

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
  salvage: SALVAGE_DEF as unknown as AnyPuzzleDef,
  overload: OVERLOAD_DEF as unknown as AnyPuzzleDef,
  deflectors: DEFLECTORS_DEF as unknown as AnyPuzzleDef,
  reactor: REACTOR_DEF as unknown as AnyPuzzleDef,
  scanner: SCANNER_DEF as unknown as AnyPuzzleDef,
  tug: TUG_DEF as unknown as AnyPuzzleDef,
  racks: RACKS_DEF as unknown as AnyPuzzleDef,
  cutting: CUTTING_DEF as unknown as AnyPuzzleDef,
};

export function isPuzzleId(x: unknown): x is PuzzleId {
  return typeof x === "string" && (PUZZLE_IDS as readonly string[]).includes(x);
}

export function isPrototypePuzzleId(x: unknown): x is PrototypePuzzleId {
  return typeof x === "string" && (PROTOTYPE_PUZZLE_IDS as readonly string[]).includes(x);
}

export function isDutyPuzzleId(x: unknown): x is DutyPuzzleId {
  return typeof x === "string" && (DUTY_PUZZLE_IDS as readonly string[]).includes(x);
}
