import type { TuningGroups } from "../groups.js";

/** Where each of Plating's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "pieceKinds"],
  deal: ["breachesAtOnce", "minBreachPieces", "maxBreachPieces"],
  pace: ["growAfterMoves"],
  scoring: ["basePerCell", "multiplierPercent", "brushBonusPercent", "streakPercent"],
  limits: ["maxMoves"],
};
