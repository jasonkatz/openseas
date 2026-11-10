import type { Preset } from "../presets.js";

/** Lab presets for Overload. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const OVERLOAD_PRESETS: readonly Preset[] = [{ id: "overload_short", overrides: { maxMoves: 10 } }];
