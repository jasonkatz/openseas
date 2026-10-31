export * from "./types.js";
export { PENTOMINOES, PENTOMINO_LETTERS, orient as carpentryOrient, extent as carpentryExtent } from "./shapes.js";
export {
  createCarpentryGame,
  reduceCarpentry,
  replayCarpentry,
  hashCarpentryState,
  summarizeCarpentry,
  checkPlacement as carpentryCheckPlacement,
  holeIndex as carpentryHoleIndex,
  placementCells as carpentryPlacementCells,
  hasLegalPlacement as carpentryHasLegalPlacement,
  effectiveGrain as carpentryEffectiveGrain,
  rateHole as carpentryRateHole,
  idx as carpentryIdx,
  validateConfig as validateCarpentryConfig,
  type CarpentrySummary,
  type PlacementCheck as CarpentryPlacementCheck,
} from "./reduce.js";
