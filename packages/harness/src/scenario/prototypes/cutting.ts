import type { Preset } from "../presets.js";

/** Lab presets for Cutting. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const CUTTING_PRESETS: readonly Preset[] = [
  { id: "cutting_clean_blocks", overrides: { flawsStart: 0, flawsMax: 0, budgetPercent: 100 } },
  { id: "cutting_tight", overrides: { budgetPercent: 66, minCuts: 2 } },
  { id: "cutting_busy", overrides: { partsStart: 7, flawsStart: 2 } },
  { id: "cutting_three_ores", overrides: { ores: 3 } },
  { id: "cutting_big_slab", overrides: { width: 8, height: 8, partsStart: 7, partsMax: 10, maxCuts: 9 } },
  { id: "cutting_ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
];
