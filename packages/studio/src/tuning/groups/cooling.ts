import type { TuningGroups } from "../groups.js";

/** Where each of Cooling's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "pieceKinds"],
  deal: ["specialChancePerMille", "initialHeatRow"],
  pace: ["heatRisePerMoves", "heatDropPerPoints", "minHeatRow"],
  scoring: ["cascadeMultipliers", "streakStepPercent", "streakMaxPercent", "streakGrace"],
  limits: ["maxMoves", "shipHeat"],
};
