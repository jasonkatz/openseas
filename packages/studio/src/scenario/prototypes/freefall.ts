import type { Preset } from "../presets.js";

/** Lab presets for Freefall. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const FREEFALL_PRESETS: readonly Preset[] = [
  { id: "freefall_solo", overrides: { rival: false } },
  { id: "freefall_sharp_rival", overrides: { rivalSkill: 100 } },
  { id: "freefall_linear", overrides: { squareClusters: false } },
  {
    id: "freefall_deep_shaft",
    overrides: {
      width: 20,
      entry: 10,
      rows: 10,
      "bays.first": [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      "bays.second": [1, 1, 2, 2, 4, 5, 8, 12, 16, 20],
      "bays.third": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "bays.fourth": [1, 2, 4, 6, 9, 12, 16, 20, 25, 30],
    },
  },
  { id: "freefall_open_shaft", overrides: { gapPermille: 330 } },
  { id: "freefall_straight_shaft", overrides: { entry: 8 } },
];
