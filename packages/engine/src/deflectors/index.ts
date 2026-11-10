import type { PuzzleDef } from "../def.js";
import { createDeflectorsGame, hashDeflectorsState, reduceDeflectors, summarizeDeflectors, validateConfig } from "./reduce.js";
import { DEFAULT_DEFLECTORS_CONFIG, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "./types.js";

export * from "./types.js";
export {
  createDeflectorsGame,
  reduceDeflectors,
  advanceDeflectors,
  hashDeflectorsState,
  summarizeDeflectors,
  validateConfig as validateDeflectorsConfig,
  portCount as deflectorsPortCount,
  portSide as deflectorsPortSide,
  portIndex as deflectorsPortIndex,
  portEntry as deflectorsPortEntry,
  turn as deflectorsTurn,
  trace as deflectorsTrace,
  volleyOptions as deflectorsVolleyOptions,
  volleyRoute as deflectorsVolleyRoute,
  volleyBest as deflectorsVolleyBest,
  beamPoints as deflectorsBeamPoints,
  volleyPoints as deflectorsVolleyPoints,
  streakPercentAt as deflectorsStreakPercentAt,
  chargeTicksAt as deflectorsChargeTicksAt,
  beamsAt as deflectorsBeamsAt,
  resolve as deflectorsResolve,
  outlook as deflectorsOutlook,
  bestPoints as deflectorsBestPoints,
  flipIllegalReason as deflectorsFlipIllegalReason,
  hint as deflectorsHint,
  viewString as deflectorsViewString,
  type DeflectorsOption,
  type DeflectorsSummary,
} from "./reduce.js";

export const DEFLECTORS_DEF: PuzzleDef<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  defaultConfig: DEFAULT_DEFLECTORS_CONFIG,
  validateConfig,
  create: createDeflectorsGame,
  reduce: reduceDeflectors,
  hash: hashDeflectorsState,
  summarize: summarizeDeflectors,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
  moveTimeMs: (m, c) => m.tick * c.tickMs,
};
