import type { PuzzleDef } from "../def.js";
import { createTractorGame, hashTractorState, reduceTractor, summarizeTractor, validateConfig } from "./reduce.js";
import { DEFAULT_TRACTOR_CONFIG, type TractorConfig, type TractorMove, type TractorState } from "./types.js";

export * from "./types.js";
export {
  createTractorGame,
  reduceTractor,
  replayTractor,
  hashTractorState,
  summarizeTractor,
  validateConfig as validateTractorConfig,
  TRACTOR_MIN_RUN,
  isLoot as tractorIsLoot,
  isBeacon as tractorIsBeacon,
  runValue as tractorRunValue,
  cacheValue as tractorCacheValue,
  cascadePercentAt as tractorCascadePercentAt,
  markCells as tractorMarkCells,
  findRuns as tractorFindRuns,
  swapIllegalReason as tractorSwapIllegalReason,
  swapValue as tractorSwapValue,
  hasSwap as tractorHasSwap,
  hint as tractorHint,
  viewString as tractorViewString,
  kindChar as tractorKindChar,
  idx as tractorIdx,
  colOf as tractorColOf,
  rowOf as tractorRowOf,
  type TractorSummary,
} from "./reduce.js";

export const TRACTOR_DEF: PuzzleDef<TractorState, TractorMove, TractorConfig> = {
  id: "tractor",
  defaultConfig: DEFAULT_TRACTOR_CONFIG,
  validateConfig,
  create: createTractorGame,
  reduce: reduceTractor,
  hash: hashTractorState,
  summarize: summarizeTractor,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
