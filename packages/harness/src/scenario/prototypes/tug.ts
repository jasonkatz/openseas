import type { Preset } from "../presets.js";

/** Lab presets for Tug. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const TUG_PRESETS: readonly Preset[] = [{ id: "tug_short", overrides: { maxMoves: 10 } }];
