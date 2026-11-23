import type { Preset } from "../presets.js";

/** Lab presets for Freefall. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const FREEFALL_PRESETS: readonly Preset[] = [
  { id: "freefall_solo", overrides: { rival: false } },
  { id: "freefall_sharp_rival", overrides: { rivalSkill: 100 } },
  { id: "freefall_linear", overrides: { squareClusters: false } },
  {
    id: "freefall_deep_shaft",
    overrides: {
      width: 10,
      rows: 8,
      "bays.first": [2, 2, 2, 2, 2],
      "bays.second": [1, 2, 4, 8, 16],
      "bays.third": [1, 2, 3, 4, 5],
      "bays.fourth": [1, 3, 6, 10, 15],
    },
  },
  { id: "freefall_open_shaft", overrides: { gapPermille: 330 } },
];
