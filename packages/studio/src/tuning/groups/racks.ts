import type { TuningGroups } from "../groups.js";

/** Where each of Racks's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["racks", "height", "kinds"],
  deal: ["startCells", "crateMin", "crateMax", "crateMixPercent", "bagCopies"],
  pace: ["landEvery"],
  scoring: ["shipPoints", "chainWindow", "chainPercent", "spillPenalty"],
  limits: ["markRoom", "maxMoves"],
};
