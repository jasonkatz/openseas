import type { PuzzleDef } from "../def.js";
import { createForgingGame, hashForgingState, reduceForging, summarizeForging, validateConfig } from "./reduce.js";
import { DEFAULT_FORGING_CONFIG, type ForgingConfig, type ForgingMove, type ForgingState } from "./types.js";

export * from "./types.js";
export {
  createForgingGame,
  reduceForging,
  replayForging,
  hashForgingState,
  summarizeForging,
  validateConfig as validateForgingConfig,
  FORGING_SET_SIZE,
  family as forgingFamily,
  dealt as forgingDealt,
  upcoming as forgingUpcoming,
  reach as forgingReach,
  targets as forgingTargets,
  targetsFrom as forgingTargetsFrom,
  strikeIllegalReason as forgingStrikeIllegalReason,
  strikeValue as forgingStrikeValue,
  chainValue as forgingChainValue,
  setValue as forgingSetValue,
  stallValue as forgingStallValue,
  hint as forgingHint,
  viewString as forgingViewString,
  markChar as forgingMarkChar,
  idx as forgingIdx,
  colOf as forgingColOf,
  rowOf as forgingRowOf,
  type ForgingSummary,
} from "./reduce.js";

export const FORGING_DEF: PuzzleDef<ForgingState, ForgingMove, ForgingConfig> = {
  id: "forging",
  defaultConfig: DEFAULT_FORGING_CONFIG,
  validateConfig,
  create: createForgingGame,
  reduce: reduceForging,
  hash: hashForgingState,
  summarize: summarizeForging,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
