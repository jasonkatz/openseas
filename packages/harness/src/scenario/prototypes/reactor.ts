import type { Preset } from "../presets.js";

/** Lab presets for Reactor. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const REACTOR_PRESETS: readonly Preset[] = [
  { id: "reactor_three_ports", overrides: { ports: 3 } },
  { id: "reactor_one_port", overrides: { ports: 1 } },
  // One grade fewer to cook, so the list of fusion scores is one shorter too.
  { id: "reactor_quick_rods", overrides: { hotGrade: 3, fusePoints: [2, 8] } },
  { id: "reactor_big_core", overrides: { size: 5 } },
  { id: "reactor_no_holding", overrides: { criticalHot: 2 } },
  { id: "reactor_short_pipeline", overrides: { pipelineSwipes: 5 } },
  { id: "reactor_twenty_swipes", overrides: { maxMoves: 20 }, roundSeconds: 60 },
];
