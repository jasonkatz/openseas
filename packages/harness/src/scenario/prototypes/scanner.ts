import type { Preset } from "../presets.js";

/** Lab presets for Scanner. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const SCANNER_PRESETS: readonly Preset[] = [{ id: "scanner_short", overrides: { maxMoves: 10 } }];
