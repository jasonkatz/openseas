import type { Preset } from "../presets.js";

/** Lab presets for Salvage. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const SALVAGE_PRESETS: readonly Preset[] = [
  { id: "salvage_four_kinds", overrides: { kinds: 4 } },
  { id: "salvage_six_kinds", overrides: { kinds: 6 } },
  { id: "salvage_crate_rush", overrides: { cratePermille: 120, maxCrates: 5, startCrates: 3 } },
  { id: "salvage_no_crates", overrides: { cratePermille: 0, maxCrates: 0, startCrates: 0 } },
  { id: "salvage_big_field", overrides: { width: 9, height: 10 } },
  { id: "salvage_ten_hauls", overrides: { maxMoves: 10 }, roundSeconds: 60 },
];
