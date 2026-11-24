import type { Preset } from "../presets.js";

/** Lab presets for Pouring. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const POURING_PRESETS: readonly Preset[] = [
  { id: "pouring_alone", overrides: { rivals: 0 } },
  { id: "pouring_one_rival", overrides: { rivals: 1 } },
  { id: "pouring_three_rivals", overrides: { rivals: 3 } },
  { id: "pouring_sharp_rivals", overrides: { rivalSkill: 100 } },
  { id: "pouring_wide_bar", overrides: { size: 7, glasses: 5, brews: 5 } },
  { id: "pouring_three_drinks", overrides: { offer: 3 } },
];
