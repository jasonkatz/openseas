import type { PuzzleDef } from "../def.js";
import { createDeflectorsGame, hashDeflectorsState, reduceDeflectors, summarizeDeflectors, validateConfig } from "./reduce.js";
import { DEFAULT_DEFLECTORS_CONFIG, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "./types.js";

export * from "./types.js";
export {
  createDeflectorsGame,
  reduceDeflectors,
  advanceDeflectors,
  replayDeflectors,
  hashDeflectorsState,
  summarizeDeflectors,
  validateConfig as validateDeflectorsConfig,
  portCount as deflectorsPortCount,
  portSide as deflectorsPortSide,
  portIndex as deflectorsPortIndex,
  portEntry as deflectorsPortEntry,
  emitterPorts as deflectorsEmitterPorts,
  turn as deflectorsTurn,
  trace as deflectorsTrace,
  traceBeams as deflectorsTraceBeams,
  isSplitter as deflectorsIsSplitter,
  beamPoints as deflectorsBeamPoints,
  litPercentAt as deflectorsLitPercentAt,
  lights as deflectorsLights,
  isMirror as deflectorsIsMirror,
  lensKind as deflectorsLensKind,
  recipeSize as deflectorsRecipeSize,
  recipeLenses as deflectorsRecipeLenses,
  resolve as deflectorsResolve,
  outlook as deflectorsOutlook,
  placeIllegalReason as deflectorsPlaceIllegalReason,
  fireIllegalReason as deflectorsFireIllegalReason,
  hint as deflectorsHint,
  cellChar as deflectorsCellChar,
  viewString as deflectorsViewString,
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
