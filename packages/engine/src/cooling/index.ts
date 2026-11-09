export * from "./types.js";
export { findMatches, groupPoints, idx, colOf, rowOf } from "./board.js";
export {
  SHIP_HEAT_EVENTS_MAX,
  createCoolingGame,
  reduceCooling,
  replayCooling,
  hashCoolingState,
  previewSwap,
  swapIllegalReason,
  heatAfterMove,
  heatRowOf,
  heatUnitsPerRow,
  summarizeCooling,
  validateConfig as validateCoolingConfig,
  type SwapPreview,
  type CoolingSummary,
} from "./reduce.js";
