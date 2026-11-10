import type { Preset } from "../presets.js";

/** Lab presets for Overload. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const OVERLOAD_PRESETS: readonly Preset[] = [
  { id: "overload_no_boosters", overrides: { boosterPermille: 0 } },
  { id: "overload_many_boosters", overrides: { boosterPermille: 200 } },
  { id: "overload_hot_bank", overrides: { refill: [20, 34, 30, 16] } },
  { id: "overload_cold_bank", overrides: { refill: [50, 30, 15, 5] } },
  { id: "overload_flat_streak", overrides: { streakPercent: [100] } },
  { id: "overload_free_taps", overrides: { tapRegenTicks: 5 } },
  { id: "overload_big_bank", overrides: { width: 8, height: 9 } },
  // Five held and one more every twelve seconds: ten taps in the minute, none given back.
  { id: "overload_ten_taps", overrides: { tapRegenTicks: 120, refundEvery: 0 }, roundSeconds: 60 },
  { id: "slow_motion", overrides: {}, speed: 0.25 },
];
