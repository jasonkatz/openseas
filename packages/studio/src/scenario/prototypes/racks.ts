import type { Preset } from "../presets.js";

/** Lab presets for Racks. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const RACKS_PRESETS: readonly Preset[] = [
  { id: "racks_gentle_marks", overrides: { markRoom: true } },
  { id: "racks_rush", overrides: { landEvery: 2 } },
  { id: "racks_slack", overrides: { landEvery: 6 } },
  { id: "racks_one_kind_crates", overrides: { crateMixPercent: 0 } },
  { id: "racks_mixed_crates", overrides: { crateMixPercent: 100 } },
  { id: "racks_loose_chain", overrides: { chainWindow: 2 } },
  { id: "racks_five_kinds", overrides: { kinds: 5, racks: 6 } },
  { id: "racks_ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
];
