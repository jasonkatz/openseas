import type { PuzzleDef } from "../def.js";
import { createRefiningGame, hashRefiningState, reduceRefining, summarizeRefining, validateConfig } from "./reduce.js";
import { DEFAULT_REFINING_CONFIG, type RefiningConfig, type RefiningMove, type RefiningState } from "./types.js";

export * from "./types.js";
export {
  createRefiningGame,
  reduceRefining,
  advanceRefining,
  replayRefining,
  hashRefiningState,
  summarizeRefining,
  validateConfig as validateRefiningConfig,
  cyclePos as refiningCyclePos,
  partner as refiningPartner,
  lowered as refiningLowered,
  neighbours as refiningNeighbours,
  pairOf as refiningPairOf,
  linked as refiningLinked,
  pairLinked as refiningPairLinked,
  links as refiningLinks,
  swapIllegalReason as refiningSwapIllegalReason,
  column as refiningColumn,
  gradeColumn as refiningGradeColumn,
  drawValue as refiningDrawValue,
  clearValue as refiningClearValue,
  ticksToDraw as refiningTicksToDraw,
  sortedness as refiningSortedness,
  afterSwap as refiningAfterSwap,
  hint as refiningHint,
  viewString as refiningViewString,
  kindChar as refiningKindChar,
  idx as refiningIdx,
  colOf as refiningColOf,
  rowOf as refiningRowOf,
  type RefiningSummary,
} from "./reduce.js";

export const REFINING_DEF: PuzzleDef<RefiningState, RefiningMove, RefiningConfig> = {
  id: "refining",
  defaultConfig: DEFAULT_REFINING_CONFIG,
  validateConfig,
  create: createRefiningGame,
  reduce: reduceRefining,
  hash: hashRefiningState,
  summarize: summarizeRefining,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => (m.tick ?? 0) * c.tickMs,
};
