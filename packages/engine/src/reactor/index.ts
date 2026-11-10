import type { PuzzleDef } from "../def.js";
import { createReactorGame, hashReactorState, reduceReactor, summarizeReactor, validateConfig } from "./reduce.js";
import { DEFAULT_REACTOR_CONFIG, type ReactorConfig, type ReactorMove, type ReactorState } from "./types.js";

export * from "./types.js";
export {
  createReactorGame,
  reduceReactor,
  replayReactor,
  hashReactorState,
  summarizeReactor,
  validateConfig as validateReactorConfig,
  DIRS as REACTOR_DIRS,
  laneCells as reactorLaneCells,
  portCell as reactorPortCell,
  isHot as reactorIsHot,
  hotCount as reactorHotCount,
  canSwipe as reactorCanSwipe,
  legalDirs as reactorLegalDirs,
  swipeOutcome as reactorSwipeOutcome,
  portStatus as reactorPortStatus,
  portLoad as reactorPortLoad,
  pipelinePercentAt as reactorPipelinePercentAt,
  salvoPercentAt as reactorSalvoPercentAt,
  pipelineLeft as reactorPipelineLeft,
  hint as reactorHint,
  viewString as reactorViewString,
  type ReactorOutcome,
  type ReactorSummary,
} from "./reduce.js";

export const REACTOR_DEF: PuzzleDef<ReactorState, ReactorMove, ReactorConfig> = {
  id: "reactor",
  defaultConfig: DEFAULT_REACTOR_CONFIG,
  validateConfig,
  create: createReactorGame,
  reduce: reduceReactor,
  hash: hashReactorState,
  summarize: summarizeReactor,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
