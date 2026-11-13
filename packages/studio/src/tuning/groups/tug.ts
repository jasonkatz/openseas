import type { TuningGroups } from "../groups.js";

/** Where each of Tug's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "pods", "blocks"],
  deal: ["startPar", "maxPar"],
  pace: ["cleanPerStep"],
  scoring: ["parPoints", "cleanPercent", "streakPercent", "slack", "slowPercent", "skipPenalty"],
  limits: ["maxMoves"],
};
