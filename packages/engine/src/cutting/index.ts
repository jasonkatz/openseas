import type { PuzzleDef } from "../def.js";
import { createCuttingGame, hashCuttingState, reduceCutting, summarizeCutting, validateConfig } from "./reduce.js";
import { DEFAULT_CUTTING_CONFIG, type CuttingConfig, type CuttingMove, type CuttingState } from "./types.js";

export * from "./types.js";
export {
  createCuttingGame,
  reduceCutting,
  replayCutting,
  hashCuttingState,
  summarizeCutting,
  validateConfig as validateCuttingConfig,
  cutIllegalReason as cuttingCutIllegalReason,
  cutPreview as cuttingCutPreview,
  bestCut as cuttingBestCut,
  bestRemaining as cuttingBestRemaining,
  slabBest as cuttingSlabBest,
  pieceAt as cuttingPieceAt,
  pureOre as cuttingPureOre,
  pieceValue as cuttingPieceValue,
  grade as cuttingGrade,
  slabShape as cuttingSlabShape,
  streakPercentAt as cuttingStreakPercentAt,
  viewString as cuttingViewString,
  type CuttingSummary,
} from "./reduce.js";

export const CUTTING_DEF: PuzzleDef<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  defaultConfig: DEFAULT_CUTTING_CONFIG,
  validateConfig,
  create: createCuttingGame,
  reduce: reduceCutting,
  hash: hashCuttingState,
  summarize: summarizeCutting,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
