import type { PuzzleDef } from "../def.js";
import { createPouringGame, hashPouringState, reducePouring, summarizePouring, validateConfig } from "./reduce.js";
import { DEFAULT_POURING_CONFIG, type PouringConfig, type PouringMove, type PouringState } from "./types.js";

export * from "./types.js";
export {
  createPouringGame,
  reducePouring,
  replayPouring,
  hashPouringState,
  summarizePouring,
  validateConfig as validatePouringConfig,
  fits as pouringFits,
  neighbours as pouringNeighbours,
  lineValue as pouringLineValue,
  slotValue as pouringSlotValue,
  pourValue as pouringPourValue,
  moveIllegalReason as pouringMoveIllegalReason,
  canPour as pouringCanPour,
  legalCells as pouringLegalCells,
  openings as pouringOpenings,
  rate as pouringRate,
  bestPour as pouringBestPour,
  hint as pouringHint,
  place as pouringPlace,
  pieceCode as pouringPieceCode,
  viewString as pouringViewString,
  idx as pouringIdx,
  colOf as pouringColOf,
  rowOf as pouringRowOf,
  type PouringSummary,
} from "./reduce.js";

export const POURING_DEF: PuzzleDef<PouringState, PouringMove, PouringConfig> = {
  id: "pouring",
  defaultConfig: DEFAULT_POURING_CONFIG,
  validateConfig,
  create: createPouringGame,
  reduce: reducePouring,
  hash: hashPouringState,
  summarize: summarizePouring,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
