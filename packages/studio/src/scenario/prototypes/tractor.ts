import type { Preset } from "../presets.js";

/** Lab presets for Tractor. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const TRACTOR_PRESETS: readonly Preset[] = [
  { id: "tractor_four_kinds", overrides: { kinds: 4 } },
  { id: "tractor_six_kinds", overrides: { kinds: 6 } },
  { id: "tractor_cache_rush", overrides: { cachePermille: 120, maxCaches: 5, startCaches: 3 } },
  { id: "tractor_beacon_rush", overrides: { beaconEvery: 2 } },
  { id: "tractor_flat_cascade", overrides: { cascadePercent: [100] } },
  { id: "tractor_wide_field", overrides: { width: 8, height: 10 } },
  { id: "tractor_twenty_swaps", overrides: { maxMoves: 20 }, roundSeconds: 60 },
];
