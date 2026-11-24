import type { TuningGroups } from "../groups.js";

/** Where each of Pact's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["hands"],
  deal: ["seatLean"],
  scoring: ["trickValue", "bagValue", "nilBonus", "bagLimit", "bagPenalty", "setBonus"],
  pace: ["handSeconds"],
  limits: ["maxMoves"],
};
