export * from "./types.js";
export {
  createSailingGame,
  reduceSailing,
  replaySailing,
  hashSailingState,
  summarizeSailing,
  landingCells as sailingLandingCells,
  pairCells as sailingPairCells,
  placeIllegalReason as sailingPlaceIllegalReason,
  hasLegalPlacement as sailingHasLegalPlacement,
  idx as sailingIdx,
  validateConfig as validateSailingConfig,
  type SailingSummary,
} from "./reduce.js";
