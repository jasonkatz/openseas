import type { Preset } from "../presets.js";

/** Lab presets for Reactor. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const REACTOR_PRESETS: readonly Preset[] = [{ id: "reactor_short", overrides: { maxMoves: 10 } }];
