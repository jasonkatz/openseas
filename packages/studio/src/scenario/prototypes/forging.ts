import type { Preset } from "../presets.js";

/** Lab presets for Forging. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const FORGING_PRESETS: readonly Preset[] = [
  { id: "forging_steps_only", overrides: { jumps: false, far: false, sparks: false, setPoints: 0 } },
  { id: "forging_two_blows", overrides: { blows: 2 } },
  { id: "forging_small_plate", overrides: { width: 5, height: 5 } },
  { id: "forging_blind", overrides: { preview: 0 } },
  { id: "forging_flat_weave", overrides: { weaveCap: 1 } },
];
