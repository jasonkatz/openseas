import type { PuzzleDef } from "../def.js";
import { createOverloadGame, hashOverloadState, reduceOverload, summarizeOverload, validateConfig } from "./reduce.js";
import { DEFAULT_OVERLOAD_CONFIG, type OverloadConfig, type OverloadMove, type OverloadState } from "./types.js";

export * from "./types.js";
export {
  createOverloadGame,
  reduceOverload,
  advanceOverload,
  replayOverload,
  hashOverloadState,
  summarizeOverload,
  validateConfig as validateOverloadConfig,
  neighbours as overloadNeighbours,
  regenProgress as overloadRegenProgress,
  chainValue as overloadChainValue,
  streakPercentAt as overloadStreakPercentAt,
  refundFor as overloadRefundFor,
  chainSize as overloadChainSize,
  hint as overloadHint,
  tapIllegalReason as overloadTapIllegalReason,
  viewString as overloadViewString,
  cellChar as overloadCellChar,
  idx as overloadIdx,
  colOf as overloadColOf,
  rowOf as overloadRowOf,
  type OverloadHint,
  type OverloadSummary,
} from "./reduce.js";

export const OVERLOAD_DEF: PuzzleDef<OverloadState, OverloadMove, OverloadConfig> = {
  id: "overload",
  defaultConfig: DEFAULT_OVERLOAD_CONFIG,
  validateConfig,
  create: createOverloadGame,
  reduce: reduceOverload,
  hash: hashOverloadState,
  summarize: summarizeOverload,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => (m.tick ?? 0) * c.tickMs,
};
