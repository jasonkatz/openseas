import type { PuzzleDef } from "../def.js";
import { createAssemblyGame, hashAssemblyState, reduceAssembly, summarizeAssembly, validateConfig } from "./reduce.js";
import { DEFAULT_ASSEMBLY_CONFIG, type AssemblyConfig, type AssemblyMove, type AssemblyState } from "./types.js";

export * from "./types.js";
export {
  createAssemblyGame,
  reduceAssembly,
  replayAssembly,
  hashAssemblyState,
  summarizeAssembly,
  validateConfig as validateAssemblyConfig,
  ASSEMBLY_SHAPES,
  isPart as assemblyIsPart,
  wayOf as assemblyWayOf,
  wayBetween as assemblyWayBetween,
  neighbours as assemblyNeighbours,
  swapIllegalReason as assemblySwapIllegalReason,
  legalSwaps as assemblyLegalSwaps,
  coverCells as assemblyCoverCells,
  fitIllegalReason as assemblyFitIllegalReason,
  legalFits as assemblyLegalFits,
  nextPlace as assemblyNextPlace,
  fitValue as assemblyFitValue,
  fitPoints as assemblyFitPoints,
  hint as assemblyHint,
  viewString as assemblyViewString,
  trayString as assemblyTrayString,
  kindChar as assemblyKindChar,
  idx as assemblyIdx,
  colOf as assemblyColOf,
  rowOf as assemblyRowOf,
  type AssemblyShape,
  type AssemblySummary,
} from "./reduce.js";

export const ASSEMBLY_DEF: PuzzleDef<AssemblyState, AssemblyMove, AssemblyConfig> = {
  id: "assembly",
  defaultConfig: DEFAULT_ASSEMBLY_CONFIG,
  validateConfig,
  create: createAssemblyGame,
  reduce: reduceAssembly,
  hash: hashAssemblyState,
  summarize: summarizeAssembly,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
