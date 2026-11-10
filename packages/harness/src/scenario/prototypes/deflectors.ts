import type { Preset } from "../presets.js";

/** Lab presets for Deflectors. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const DEFLECTORS_PRESETS: readonly Preset[] = [{ id: "deflectors_short", overrides: { maxMoves: 10 } }];
