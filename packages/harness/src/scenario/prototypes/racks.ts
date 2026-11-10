import type { Preset } from "../presets.js";

/** Lab presets for Racks. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const RACKS_PRESETS: readonly Preset[] = [{ id: "racks_short", overrides: { maxMoves: 10 } }];
