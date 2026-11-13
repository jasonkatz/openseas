import type { TuningGroups } from "../groups.js";

/** Where each of Cutting's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "ores"],
  deal: ["partsStart", "partsMax", "flawsStart", "flawsMax", "maxBlockPercent", "budgetPercent", "minCuts", "maxCuts"],
  pace: ["growEvery"],
  scoring: ["cellPoints", "cleanPercent", "cleanBonus", "flawlessBonus", "streakPercent"],
  limits: ["maxMoves"],
};
