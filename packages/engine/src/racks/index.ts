import type { PuzzleDef } from "../def.js";
import { createRacksGame, hashRacksState, reduceRacks, summarizeRacks, validateConfig } from "./reduce.js";
import { DEFAULT_RACKS_CONFIG, type RacksConfig, type RacksMove, type RacksState } from "./types.js";

export * from "./types.js";
export {
  createRacksGame,
  reduceRacks,
  hashRacksState,
  summarizeRacks,
  validateConfig as validateRacksConfig,
  topGroup as racksTopGroup,
  moveIllegalReason as racksMoveIllegalReason,
  movable as racksMovable,
  isShipment as racksIsShipment,
  wouldShip as racksWouldShip,
  crateFits as racksCrateFits,
  crateWouldShip as racksCrateWouldShip,
  chainPercentAt as racksChainPercentAt,
  shipmentPoints as racksShipmentPoints,
  nextShipment as racksNextShipment,
  hint as racksHint,
  viewString as racksViewString,
  type RacksSummary,
} from "./reduce.js";

export const RACKS_DEF: PuzzleDef<RacksState, RacksMove, RacksConfig> = {
  id: "racks",
  defaultConfig: DEFAULT_RACKS_CONFIG,
  validateConfig,
  create: createRacksGame,
  reduce: reduceRacks,
  hash: hashRacksState,
  summarize: summarizeRacks,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
