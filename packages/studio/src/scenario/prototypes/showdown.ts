import type { Preset } from "../presets.js";

/** Lab presets for Showdown. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const SHOWDOWN_PRESETS: readonly Preset[] = [
  { id: "showdown_heads_up", overrides: { rivals: 1, styles: ["shark"] } },
  { id: "showdown_full_table", overrides: { rivals: 5, styles: ["brick", "sponge", "hothead", "shark", "sponge"] } },
  { id: "showdown_soft_table", overrides: { styles: ["sponge", "hothead", "sponge", "hothead"] } },
  { id: "showdown_tough_table", overrides: { styles: ["shark", "shark", "shark"] } },
  { id: "showdown_short", overrides: { hands: 4 } },
  { id: "showdown_no_cap", overrides: { raiseCap: 8 } },
];
