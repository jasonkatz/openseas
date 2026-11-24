import type { Preset } from "../presets.js";

/** Lab presets for Deflectors. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const DEFLECTORS_PRESETS: readonly Preset[] = [
  { id: "deflectors_two_emitters", overrides: { emitters: 2, litPercent: [100, 200] } },
  { id: "deflectors_flat_shots", overrides: { litPercent: [100, 100, 100] } },
  { id: "deflectors_no_recipes", overrides: { recipeWeights: [1], lenses: 0, lensChance: 0 } },
  { id: "deflectors_one_lens", overrides: { recipeWeights: [30, 70] } },
  { id: "deflectors_still", overrides: { spend: false } },
  { id: "deflectors_fast_pieces", overrides: { pieceTicks: 8 } },
  { id: "deflectors_slow_pieces", overrides: { pieceTicks: 25 } },
  { id: "deflectors_big_grid", overrides: { size: 8, emitters: 4, targets: 7, mirrors: 8, lenses: 3, litPercent: [100, 200, 400, 800] } },
  { id: "deflectors_short_round", overrides: { maxTick: 600 }, roundSeconds: 60 },
];
