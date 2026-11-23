import type { PuzzleDef } from "../def.js";
import { createFreefallGame, hashFreefallState, reduceFreefall, summarizeFreefall, validateConfig } from "./reduce.js";
import { DEFAULT_FREEFALL_CONFIG, type FreefallConfig, type FreefallMove, type FreefallState } from "./types.js";

export * from "./types.js";
export {
  createFreefallGame,
  reduceFreefall,
  replayFreefall,
  hashFreefallState,
  summarizeFreefall,
  validateConfig as validateFreefallConfig,
  bayValue as freefallBayValue,
  bayValues as freefallBayValues,
  landingPoints as freefallLandingPoints,
  cradleLane as freefallCradleLane,
  armLane as freefallArmLane,
  rockerTable as freefallRockerTable,
  fall as freefallFall,
  dropIllegalReason as freefallDropIllegalReason,
  dropValue as freefallDropValue,
  dropValues as freefallDropValues,
  rivalLane as freefallRivalLane,
  hint as freefallHint,
  viewString as freefallViewString,
  type FreefallSummary,
} from "./reduce.js";

export const FREEFALL_DEF: PuzzleDef<FreefallState, FreefallMove, FreefallConfig> = {
  id: "freefall",
  defaultConfig: DEFAULT_FREEFALL_CONFIG,
  validateConfig,
  create: createFreefallGame,
  reduce: reduceFreefall,
  hash: hashFreefallState,
  summarize: summarizeFreefall,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
