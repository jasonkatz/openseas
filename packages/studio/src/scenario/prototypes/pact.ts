import type { Preset } from "../presets.js";

/** Lab presets for Pact. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const PACT_PRESETS: readonly Preset[] = [
  { id: "pact_short", overrides: { hands: 1 } },
  { id: "pact_long", overrides: { hands: 8 } },
  { id: "pact_no_nil", overrides: { nilBonus: 0 } },
  { id: "pact_no_bags", overrides: { bagLimit: 0 } },
  { id: "pact_plain", overrides: { nilBonus: 0, bagLimit: 0, setBonus: 0 } },
];
