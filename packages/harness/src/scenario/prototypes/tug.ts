import type { Preset } from "../presets.js";

/** Lab presets for Tug. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const TUG_PRESETS: readonly Preset[] = [
  { id: "tug_open_bay", overrides: { blocks: 0 } },
  { id: "tug_crowded_bay", overrides: { blocks: 9, pods: 5 } },
  { id: "tug_big_bay", overrides: { width: 9, height: 9, blocks: 8 } },
  { id: "tug_easy_clamps", overrides: { maxPar: 2 } },
  { id: "tug_hard_clamps", overrides: { startPar: 4 } },
  { id: "tug_ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
];
