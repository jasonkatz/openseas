export * from "./types.js";
export { findMatches, groupPoints, idx, colOf, rowOf } from "./board.js";
export {
  SHIP_WATER_EVENTS_MAX,
  createBilgingGame,
  reduceBilging,
  replayBilging,
  hashBilgingState,
  previewSwap,
  swapIllegalReason,
  waterAfterMove,
  waterRowOf,
  waterUnitsPerRow,
  summarizeBilging,
  validateConfig as validateBilgingConfig,
  type SwapPreview,
  type BilgingSummary,
} from "./reduce.js";
