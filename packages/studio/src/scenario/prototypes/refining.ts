import type { Preset } from "../presets.js";

/** Lab presets for Refining. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const REFINING_PRESETS: readonly Preset[] = [
  { id: "refining_rich_feed", overrides: { vapourPermille: 500, oilPermille: 250 } },
  { id: "refining_lean_feed", overrides: { vapourPermille: 340, oilPermille: 330 } },
  { id: "refining_short_tower", overrides: { height: 4 } },
  { id: "refining_tall_tower", overrides: { height: 8 } },
  { id: "refining_slow_burn", overrides: { pulseTicks: 120 } },
  { id: "refining_fast_burn", overrides: { pulseTicks: 50 } },
  { id: "refining_catalyst_rich", overrides: { catalystPermille: 100 } },
];
