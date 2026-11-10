import type { PuzzleDef } from "../def.js";
import { createSalvageGame, hashSalvageState, reduceSalvage, summarizeSalvage, validateConfig } from "./reduce.js";
import { DEFAULT_SALVAGE_CONFIG, type SalvageConfig, type SalvageMove, type SalvageState } from "./types.js";

export * from "./types.js";
export {
  createSalvageGame,
  reduceSalvage,
  replaySalvage,
  hashSalvageState,
  summarizeSalvage,
  validateConfig as validateSalvageConfig,
  adjacent as salvageAdjacent,
  canLink as salvageCanLink,
  canExtend as salvageCanExtend,
  canClose as salvageCanClose,
  lineIllegalReason as salvageLineIllegalReason,
  enclosedCells as salvageEnclosedCells,
  lineValue as salvageLineValue,
  streakPercentAt as salvageStreakPercentAt,
  hasLine as salvageHasLine,
  hint as salvageHint,
  findLoop as salvageFindLoop,
  viewString as salvageViewString,
  kindChar as salvageKindChar,
  idx as salvageIdx,
  colOf as salvageColOf,
  rowOf as salvageRowOf,
  type SalvageSummary,
} from "./reduce.js";

export const SALVAGE_DEF: PuzzleDef<SalvageState, SalvageMove, SalvageConfig> = {
  id: "salvage",
  defaultConfig: DEFAULT_SALVAGE_CONFIG,
  validateConfig,
  create: createSalvageGame,
  reduce: reduceSalvage,
  hash: hashSalvageState,
  summarize: summarizeSalvage,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
