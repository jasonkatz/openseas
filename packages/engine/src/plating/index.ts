export * from "./types.js";
export { PENTOMINOES, PENTOMINO_LETTERS, orient as platingOrient, extent as platingExtent } from "./shapes.js";
export {
  createPlatingGame,
  reducePlating,
  replayPlating,
  hashPlatingState,
  summarizePlating,
  checkPlacement as platingCheckPlacement,
  breachIndex as platingBreachIndex,
  placementCells as platingPlacementCells,
  hasLegalPlacement as platingHasLegalPlacement,
  effectiveBrush as platingEffectiveBrush,
  rateBreach as platingRateBreach,
  idx as platingIdx,
  validateConfig as validatePlatingConfig,
  type PlatingSummary,
  type PlacementCheck as PlatingPlacementCheck,
} from "./reduce.js";
