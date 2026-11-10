import type { PuzzleDef } from "../def.js";
import { createTugGame, hashTugState, reduceTug, summarizeTug, validateConfig } from "./reduce.js";
import { DEFAULT_TUG_CONFIG, type TugConfig, type TugMove, type TugState } from "./types.js";

export * from "./types.js";
export {
  createTugGame,
  reduceTug,
  hashTugState,
  summarizeTug,
  validateConfig as validateTugConfig,
  slide as tugSlide,
  flickIllegalReason as tugFlickIllegalReason,
  wantPar as tugWantPar,
  streakPercentAt as tugStreakPercentAt,
  gradeAt as tugGradeAt,
  deliveryPoints as tugDeliveryPoints,
  solve as tugSolve,
  viewString as tugViewString,
  stateViewString as tugStateViewString,
  idx as tugIdx,
  colOf as tugColOf,
  rowOf as tugRowOf,
  type TugSummary,
} from "./reduce.js";

export const TUG_DEF: PuzzleDef<TugState, TugMove, TugConfig> = {
  id: "tug",
  defaultConfig: DEFAULT_TUG_CONFIG,
  validateConfig,
  create: createTugGame,
  reduce: reduceTug,
  hash: hashTugState,
  summarize: summarizeTug,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
