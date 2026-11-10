import type { Preset } from "../presets.js";

/** Lab presets for Cutting. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const CUTTING_PRESETS: readonly Preset[] = [{ id: "cutting_short", overrides: { maxMoves: 10 } }];
