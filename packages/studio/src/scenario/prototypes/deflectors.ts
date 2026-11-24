import type { Preset } from "../presets.js";

/** Lab presets for Deflectors. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const DEFLECTORS_PRESETS: readonly Preset[] = [
  { id: "deflectors_one_beam", overrides: { beams: 1 } },
  { id: "deflectors_three_beams", overrides: { beams: 3 } },
  { id: "deflectors_no_recipes", overrides: { recipeLenses: 0, lenses: 0 } },
  { id: "deflectors_one_lens", overrides: { recipeLenses: 1 } },
  { id: "deflectors_still", overrides: { spend: false } },
  { id: "deflectors_sparse", overrides: { mirrors: 10 } },
  { id: "deflectors_dense", overrides: { mirrors: 18 } },
  { id: "deflectors_big_grid", overrides: { size: 8, mirrors: 24, lenses: 5 } },
  { id: "deflectors_short_round", overrides: { maxTick: 600 }, roundSeconds: 60 },
];
