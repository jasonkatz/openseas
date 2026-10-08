export * from "./types.js";
export { findMatches, groupPoints, idx, colOf, rowOf } from "./board.js";
export {
  createBilgingGame,
  reduceBilging,
  replayBilging,
  hashBilgingState,
  previewSwap,
  swapIllegalReason,
  waterRowFor,
  summarizeBilging,
  validateConfig as validateBilgingConfig,
  type SwapPreview,
  type BilgingSummary,
} from "./reduce.js";
